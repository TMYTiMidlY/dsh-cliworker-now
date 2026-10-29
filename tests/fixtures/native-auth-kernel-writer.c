/* Synthetic OS regression peer only. Never packaged or used by Host. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc != 3) return 1;
  if (!strcmp(argv[1], "truncate-aba")) {
    char original[256]; int r = open(argv[2], O_RDONLY);
    if (r < 0) return 2;
    ssize_t n = read(r, original, sizeof(original)); close(r);
    if (n <= 0 || n == (ssize_t)sizeof(original)) return 3;
    puts("SYNTHETIC_READY"); fflush(stdout);
    int w = open(argv[2], O_WRONLY | O_TRUNC);
    if (w < 0) return 4;
    if (write(w, "SYNTHETIC_B", 11) != 11 || ftruncate(w, 0) || lseek(w, 0, SEEK_SET) < 0 || write(w, original, (size_t)n) != n || fsync(w)) return 5;
    close(w); memset(original, 0, sizeof(original)); return 0;
  }
  if (!strcmp(argv[1], "mmap") || !strcmp(argv[1], "mprotect")) {
    int fd = open(argv[2], O_RDWR); if (fd < 0) return 6;
    int protection = !strcmp(argv[1], "mmap") ? PROT_READ | PROT_WRITE : PROT_READ;
    void *mapping = mmap(NULL, 4096, protection, MAP_SHARED, fd, 0);
    if (mapping == MAP_FAILED) return 7;
    close(fd); /* The mapping, not an open descriptor, retains write capability. */
    puts("SYNTHETIC_READY"); fflush(stdout);
    char command;
    if (read(STDIN_FILENO, &command, 1) != 1) return 8;
    if (!strcmp(argv[1], "mprotect") && mprotect(mapping, 4096, PROT_READ | PROT_WRITE)) return 9;
    if (munmap(mapping, 4096)) return 10;
    return 0;
  }
  return 11;
}
