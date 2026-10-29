## ADDED Requirements

### Requirement: Bounded account-scoped AGY catalog discovery
The Host SHALL allow AGY native catalog probes up to 60 seconds, keep the generic metadata default at 15 seconds, and preserve exact account, model, effort and execution authorization checks.

#### Scenario: Valid response after the former short deadline
- **WHEN** an AGY catalog probe completes successfully after 15 seconds and before 60 seconds
- **THEN** the Host MUST validate and return its native model rows instead of failing solely on the former deadline
- **AND** this SHALL NOT change the task deadline or another CLI's default catalog budget

#### Scenario: Selected isolated account
- **WHEN** a caller explicitly selects lxy
- **THEN** settings validation, identity and the directory child process MUST use the same selected HOME
- **AND** the parent HOME and other CLI settings MUST remain unchanged

### Requirement: Bound Worker catalogs retain their selected account
The Host SHALL use the Worker's effective AGY account for both binding validation and native discovery, even when it differs from the deployment default.

#### Scenario: Worker and deployment use opposite accounts
- **WHEN** a Worker bound to default or lxy requests models through a Tool or Remote while the deployment defaults to the other account
- **THEN** both binding and discovery MUST use the Worker's selected account
- **AND** the stored binding, Worker preference, deployment default and history MUST NOT be changed by the query
- **AND** a genuine change of the selected source MUST remain a rejection

### Requirement: Cancellation and safe diagnostics remain authoritative
The Host SHALL distinguish its metadata deadline from caller cancellation without guessing from error text, and MUST await process cleanup before admitting further work.

#### Scenario: Caller cancels
- **WHEN** the caller aborts a directory request
- **THEN** the original cancellation MUST be preserved and its child process MUST be terminated and confirmed exited
- **AND** an already cancelled request MUST start no process

#### Scenario: Internal metadata deadline
- **WHEN** the AGY directory exceeds the bounded deadline
- **THEN** the error MUST identify the metadata timeout/deadline phase without retaining credentials, argv, stderr or native paths

#### Scenario: Cleanup is uncertain
- **WHEN** child termination or exit cannot be confirmed
- **THEN** cleanup uncertainty MUST take precedence over deadline and cancellation diagnostics
- **AND** the existing admission block MUST remain effective

#### Scenario: Native CLI exits unsuccessfully
- **WHEN** a safe diagnostic probe observes a nonzero native exit
- **THEN** it MAY report a fixed, finite diagnostic hint matched from bounded output without retaining or copying native text, credentials, argv or paths
- **AND** the hint MUST remain a native-text category, not proof of login, quota, account identity or permission
- **AND** cleanup uncertainty and actual caller cancellation MUST retain their existing precedence

#### Scenario: Previous probe completes
- **WHEN** an earlier completed probe later reaches its private timer deadline
- **THEN** its parent signal and subsequent independent probe MUST remain unaffected
