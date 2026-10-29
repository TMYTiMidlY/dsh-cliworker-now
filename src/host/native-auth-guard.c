/* Auth snapshot guard protocol 1. Self-authored Linux/x86-64 metadata-only
 * companion. It never reads credential bytes, writes source files, forks,
 * compiles code, or executes a vendor CLI. See doc/native-auth-snapshot.md. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/inotify.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/signalfd.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <time.h>
#include <unistd.h>

#define FILES 16
#define DIRS 256
#define FILTERS 32
#define FRAME 4096
#define MODS (IN_MODIFY | IN_ATTRIB | IN_CLOSE_WRITE | IN_DELETE_SELF | IN_MOVE_SELF)
#define DIRMODS (IN_ATTRIB | IN_CREATE | IN_DELETE | IN_MOVED_FROM | IN_MOVED_TO | IN_DELETE_SELF | IN_MOVE_SELF)
struct file_entry { int fd; size_t limit; struct stat initial; };
struct dir_entry { int fd; int wd; unsigned count; char names[FILTERS][256]; struct stat initial; };
static struct file_entry files[FILES];
static struct dir_entry dirs[DIRS];
static unsigned file_count, dir_count;
static int events_fd = -1, signals_fd = -1;
static char nonce[33];
static int64_t deadline;
static pid_t parent;
static int armed;
static void drain(void);

static int64_t now_ms(void) {
  struct timespec t;
  if (clock_gettime(CLOCK_MONOTONIC, &t) || t.tv_sec < 0 || t.tv_sec > INT64_MAX / 1000 - 30) _exit(1);
  return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}
static int same(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino && a->st_mode == b->st_mode &&
    a->st_uid == b->st_uid && a->st_gid == b->st_gid && a->st_nlink == b->st_nlink && a->st_size == b->st_size &&
    a->st_mtim.tv_sec == b->st_mtim.tv_sec && a->st_mtim.tv_nsec == b->st_mtim.tv_nsec &&
    a->st_ctim.tv_sec == b->st_ctim.tv_sec && a->st_ctim.tv_nsec == b->st_ctim.tv_nsec;
}
static int local_fs(int fd) {
  struct statfs fs;
  if (fstatfs(fd, &fs)) return 0;
  /* Known local Linux filesystems. No network, FUSE, procfs or unknown magic.
   * A recognized magic still MUST successfully supply leases and watches. */
  switch ((unsigned long)fs.f_type) {
    case 0xef53UL: case 0x58465342UL: case 0x9123683eUL:
    case 0x01021994UL: case 0x794c7630UL: return 1;
    default: return 0;
  }
}
static void release_all(void) {
  for (unsigned i = 0; i < file_count && i < FILES; i++) if (files[i].fd >= 0) {
    (void)fcntl(files[i].fd, F_SETLEASE, F_UNLCK);
    (void)close(files[i].fd); files[i].fd = -1;
  }
  if (events_fd >= 0) (void)close(events_fd);
  if (signals_fd >= 0) (void)close(signals_fd);
}
static _Noreturn void stop(const char *code) {
  /* Only fixed enum literals reach this function. No perror/raw input/path. */
  if (nonce[0]) (void)dprintf(STDOUT_FILENO, "AS1 %s ERROR %s\n", nonce, code);
  release_all(); _exit(1);
}
static int wait_input(void) {
  for (;;) {
    if (getppid() != parent || now_ms() >= deadline) return -1;
    struct pollfd p[3] = { { .fd = STDIN_FILENO, .events = POLLIN }, { .fd = events_fd, .events = POLLIN }, { .fd = signals_fd, .events = POLLIN } };
    int remaining = (int)(deadline - now_ms());
    if (remaining <= 0) return -1;
    int n = poll(p, armed ? 3 : 1, remaining);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0 || (p[0].revents & (POLLERR | POLLNVAL))) return -1;
    if (armed && (p[1].revents || p[2].revents)) drain();
    if (p[0].revents & (POLLIN | POLLHUP)) return 0;
  }
}
static int line(char *buf, size_t cap) {
  size_t used = 0;
  while (used + 1 < cap) {
    if (wait_input()) return -1;
    ssize_t n = read(STDIN_FILENO, buf + used, 1);
    if (n < 0 && (errno == EINTR || errno == EAGAIN)) continue;
    if (n != 1) return -1;
    if (buf[used] == '\n') { buf[used] = '\0'; return 0; }
    if (buf[used] == '\0') return -1;
    used++;
  }
  return -1;
}
static int hex_digit(char ch) {
  if (ch >= '0' && ch <= '9') return ch - '0';
  if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
  return -1;
}
static unsigned number(char **cursor, unsigned max, int last) {
  char *p = *cursor; unsigned value = 0;
  if (*p < '0' || *p > '9') stop("PROTOCOL");
  while (*p >= '0' && *p <= '9') {
    unsigned digit = (unsigned)(*p - '0');
    if (value > max / 10 || (value == max / 10 && digit > max % 10)) stop("PROTOCOL");
    value = value * 10 + digit; p++;
  }
  if (*p != (last ? '\0' : ' ')) stop("PROTOCOL");
  *cursor = last ? p : p + 1; return value;
}
static void decode_name(char *out, const char *in) {
  size_t n = strlen(in);
  if (!n || n > 510 || n % 2) stop("PROTOCOL");
  for (size_t i = 0; i < n; i += 2) {
    int a = hex_digit(in[i]), b = hex_digit(in[i + 1]);
    if (a < 0 || b < 0) stop("PROTOCOL");
    unsigned ch = (unsigned)(a * 16 + b);
    if (!ch || ch == '/') stop("PROTOCOL");
    out[i / 2] = (char)ch;
  }
  out[n / 2] = '\0';
  if (!strcmp(out, ".") || !strcmp(out, "..")) stop("PROTOCOL");
}
static void proc_path(char *buf, size_t cap, int fd) {
  int n = snprintf(buf, cap, "/proc/self/fd/%d", fd);
  if (n < 0 || (size_t)n >= cap) stop("PROTOCOL");
}
static int relevant(const struct inotify_event *event) {
  if (!event->len || event->name[0] == '\0') return 1;
  int matched_directory = 0;
  for (unsigned i = 0; i < dir_count; i++) if (dirs[i].wd == event->wd) {
    matched_directory = 1;
    /* add_watch aliases for the same inode share a wd. Union all filters,
     * never treat the first directory entry as the whole authorization. */
    for (unsigned j = 0; j < dirs[i].count; j++) if (!strcmp(dirs[i].names[j], event->name)) return 1;
  }
  return !matched_directory; /* File watches/unknown descriptors never ignored. */
}
static void drain(void) {
  char buf[65536] __attribute__((aligned(__alignof__(struct inotify_event))));
  for (;;) {
    if (now_ms() >= deadline || getppid() != parent) stop("TIMEOUT");
    ssize_t n = read(events_fd, buf, sizeof(buf));
    if (n < 0 && errno == EINTR) continue;
    if (n < 0 && errno == EAGAIN) break;
    if (n <= 0) stop("PROTOCOL");
    size_t at = 0;
    while (at < (size_t)n) {
      if ((size_t)n - at < sizeof(struct inotify_event)) stop("PROTOCOL");
      const struct inotify_event *e = (const struct inotify_event *)(buf + at);
      size_t size = sizeof(*e) + e->len;
      if (size > (size_t)n - at || (e->len && !memchr(e->name, '\0', e->len))) stop("PROTOCOL");
      if (e->mask & IN_Q_OVERFLOW) stop("OVERFLOW");
      if (e->mask & (IN_IGNORED | IN_UNMOUNT)) stop("CHANGED");
      if (e->mask & ~(MODS | DIRMODS | IN_ISDIR)) stop("PROTOCOL");
      if (relevant(e)) stop("CHANGED");
      at += size;
    }
  }
  struct signalfd_siginfo signal_info;
  ssize_t n = read(signals_fd, &signal_info, sizeof(signal_info));
  if (n >= 0 || errno != EAGAIN) stop("CHANGED");
  for (unsigned i = 0; i < file_count; i++) {
    struct stat current;
    /* During a pending break GETLEASE already reports the target UNLCK. */
    if (fcntl(files[i].fd, F_GETLEASE) != F_RDLCK || fstat(files[i].fd, &current) || !same(&current, &files[i].initial)) stop("CHANGED");
  }
  for (unsigned i = 0; i < dir_count; i++) {
    struct stat current;
    const struct stat *initial = &dirs[i].initial;
    /* Sibling target staging can change ancestor size/mtime/nlink. Relevant
     * child-name events and Node's anchored path recheck cover path binding. */
    if (fstat(dirs[i].fd, &current) || current.st_dev != initial->st_dev || current.st_ino != initial->st_ino ||
        current.st_mode != initial->st_mode || current.st_uid != initial->st_uid || current.st_gid != initial->st_gid) stop("CHANGED");
  }
}
int main(int argc, char **argv) {
  (void)argv;
  if (argc != 1) return 1;
  for (unsigned i = 0; i < FILES; i++) files[i].fd = -1;
  parent = getppid(); deadline = now_ms() + 3000;
  struct rlimit core = { 0, 0 };
  if (getuid() != geteuid() || setrlimit(RLIMIT_CORE, &core) || prctl(PR_SET_DUMPABLE, 0) ||
      prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || prctl(PR_SET_PDEATHSIG, SIGKILL) || getppid() != parent) return 1;
  sigset_t mask; sigemptyset(&mask); sigaddset(&mask, SIGIO); sigaddset(&mask, SIGRTMIN);
  if (sigprocmask(SIG_BLOCK, &mask, NULL)) return 1;
  signals_fd = signalfd(-1, &mask, SFD_CLOEXEC | SFD_NONBLOCK);
  events_fd = inotify_init1(IN_CLOEXEC | IN_NONBLOCK);
  if (signals_fd < 0 || events_fd < 0) return 1;
  char buf[FRAME];
  if (line(buf, sizeof(buf)) || strlen(buf) < 37 || strncmp(buf, "AS1 ", 4) || buf[36] != ' ') stop("PROTOCOL");
  for (unsigned i = 0; i < 32; i++) if (hex_digit(buf[4 + i]) < 0) stop("PROTOCOL");
  memcpy(nonce, buf + 4, 32); nonce[32] = '\0';
  char *cursor = buf + 37;
  unsigned parent_input = number(&cursor, INT_MAX, 0), timeout = number(&cursor, 30000, 0);
  file_count = number(&cursor, FILES, 0); dir_count = number(&cursor, DIRS, 1);
  if (parent_input != (unsigned)parent || timeout < 1 || file_count < 1 || dir_count < 1) stop("PROTOCOL");
  deadline = now_ms() + timeout;
  /* Read only metadata specifications. Input never contains credential bytes. */
  size_t limits[FILES];
  for (unsigned i = 0; i < file_count; i++) {
    if (line(buf, sizeof(buf))) stop("PROTOCOL");
    cursor = buf;
    unsigned inherited = number(&cursor, 3 + FILES + DIRS, 0);
    limits[i] = number(&cursor, 1048576, 1);
    if (inherited != 3 + i || !limits[i]) stop("PROTOCOL");
  }
  for (unsigned i = 0; i < dir_count; i++) {
    if (line(buf, sizeof(buf))) stop("PROTOCOL");
    cursor = buf;
    unsigned inherited = number(&cursor, 3 + FILES + DIRS, 0);
    dirs[i].count = number(&cursor, FILTERS, 1);
    if (inherited != 3 + file_count + i || dirs[i].count < 1) stop("PROTOCOL");
    dirs[i].fd = (int)inherited;
    for (unsigned j = 0; j < dirs[i].count; j++) { if (line(buf, sizeof(buf))) stop("PROTOCOL"); decode_name(dirs[i].names[j], buf); }
    if (fstat(dirs[i].fd, &dirs[i].initial) || !S_ISDIR(dirs[i].initial.st_mode) ||
        (dirs[i].initial.st_uid != getuid() && dirs[i].initial.st_uid != 0) || (dirs[i].initial.st_mode & 0022)) stop("UNSAFE");
    if (!local_fs(dirs[i].fd)) stop("UNSUPPORTED");
    char path[64]; proc_path(path, sizeof(path), dirs[i].fd);
    dirs[i].wd = inotify_add_watch(events_fd, path, DIRMODS | IN_ONLYDIR | IN_MASK_ADD);
    if (dirs[i].wd < 0) stop("UNSUPPORTED");
  }
  for (unsigned i = 0; i < file_count; i++) {
    int inherited = (int)(3 + i); char path[64]; struct stat original;
    proc_path(path, sizeof(path), inherited);
    if (fstat(inherited, &original)) stop("UNSAFE");
    /* open(/proc/self/fd/N), NOT dup(N): own independent open description.
     * Node retains its unleased description; our death releases every lease. */
    files[i].fd = open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    files[i].limit = limits[i];
    if (files[i].fd < 0 || fstat(files[i].fd, &files[i].initial) || !same(&original, &files[i].initial) ||
        !S_ISREG(original.st_mode) || original.st_uid != getuid() || original.st_nlink != 1 ||
        (original.st_mode & 07777) != 0600 || original.st_size < 0 || (uint64_t)original.st_size > limits[i]) stop("UNSAFE");
    if (!local_fs(files[i].fd)) stop("UNSUPPORTED");
    proc_path(path, sizeof(path), files[i].fd);
    if (inotify_add_watch(events_fd, path, MODS | IN_MASK_ADD) < 0) stop("UNSUPPORTED");
    if (fcntl(files[i].fd, F_SETOWN, getpid()) || fcntl(files[i].fd, F_SETSIG, SIGRTMIN)) stop("UNSUPPORTED");
    if (fcntl(files[i].fd, F_SETLEASE, F_RDLCK)) stop(errno == EAGAIN ? "BUSY" : "UNSUPPORTED");
    (void)close(inherited);
  }
  armed = 1; drain();
  if (dprintf(STDOUT_FILENO, "AS1 %s READY 0\n", nonce) < 0) stop("PROTOCOL");
  int checked = 0;
  for (;;) {
    drain();
    int remaining = (int)(deadline - now_ms());
    if (remaining <= 0 || getppid() != parent) stop("TIMEOUT");
    struct pollfd p[3] = { { .fd = STDIN_FILENO, .events = POLLIN }, { .fd = events_fd, .events = POLLIN }, { .fd = signals_fd, .events = POLLIN } };
    int n = poll(p, 3, remaining);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) stop("TIMEOUT");
    if (p[1].revents || p[2].revents) { drain(); continue; }
    if (p[0].revents & (POLLERR | POLLHUP | POLLNVAL)) stop("PROTOCOL");
    if (p[0].revents & POLLIN) {
      if (line(buf, sizeof(buf))) stop("PROTOCOL");
      char expected[80];
      int size = snprintf(expected, sizeof(expected), checked ? "AS1 %s SEAL 2" : "AS1 %s CHECK 1", nonce);
      if (size < 0 || (size_t)size >= sizeof(expected) || strcmp(buf, expected)) stop("PROTOCOL");
      drain();
      if (!checked) {
        /* Confirm the Node read window before any callback may use bytes. A
         * helper that broke/exited during the read can never supply this ACK. */
        checked = 1;
        if (dprintf(STDOUT_FILENO, "AS1 %s CHECKED 1\n", nonce) < 0) stop("PROTOCOL");
        continue;
      }
      /* Linearization point: the last successful queue drain while leases
       * remain held, following Node's source-path recheck and target callback.
       * It is not a cross-directory transaction with later publication. */
      if (dprintf(STDOUT_FILENO, "AS1 %s SEALED 2\n", nonce) < 0) stop("PROTOCOL");
      release_all(); return 0;
    }
  }
}
