# Security Specification — SkySah Accounting (Agency Ledger)

## 1. Data Invariants
1. **Identity & Ownership**:
   - A `LedgerWorkspace` at `/ledgers/{userId}` can only be read, created, updated, or deleted by the authenticated user whose `request.auth.uid == userId` and `incoming().ownerId == request.auth.uid`.
   - A `StaffAccount` at `/staffAccounts/{username}` can only be read, created, updated, or deleted by the authenticated agency owner whose `request.auth.uid == ownerId`.
2. **Email Verification**: All writes require `request.auth.token.email_verified == true`.
3. **Immutable Fields**: `ownerId` and `createdAt` cannot be modified after creation.
4. **Server Timestamps**: `createdAt` must equal `request.time` on creation; `updatedAt` must equal `request.time` on both creation and update.
5. **Strict Key & Size Boundaries**: No shadow fields are permitted (`hasOnly`), and `payload` is bounded between 2 and 950,000 characters.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: `auth = null`, payload `{ ownerId: "u1", ... }` -> `PERMISSION_DENIED`
2. **Unverified Email Write**: `auth = { uid: "u1", token: { email_verified: false } }` -> `PERMISSION_DENIED`
3. **Cross-User Read (PII/Financial Leak)**: User `u2` attempting `get(/ledgers/u1)` -> `PERMISSION_DENIED`
4. **Identity Spoofing on Create**: User `u1` creating `/ledgers/u1` with `ownerId: "u2"` -> `PERMISSION_DENIED`
5. **Path Mismatch on Create**: User `u1` creating `/ledgers/u2` with `ownerId: "u1"` -> `PERMISSION_DENIED`
6. **Shadow Field Injection on Create**: Payload includes `isAdmin: true` -> `PERMISSION_DENIED`
7. **Shadow Field Injection on Update**: Update includes `hacked: 1` -> `PERMISSION_DENIED`
8. **Immutable Field Mutation (`ownerId`)**: Update changes `ownerId` from `"u1"` to `"u2"` -> `PERMISSION_DENIED`
9. **Immutable Field Mutation (`createdAt`)**: Update changes `createdAt` -> `PERMISSION_DENIED`
10. **Forged Client Timestamp (`updatedAt`)**: Update sets `updatedAt` to a past/future timestamp instead of `request.time` -> `PERMISSION_DENIED`
11. **Value Poisoning (`payload` type)**: Update sets `payload: 12345` (number instead of string) -> `PERMISSION_DENIED`
12. **Resource Exhaustion (`userId` path poisoning)**: Path variable `userId` contains invalid regex characters or >128 chars -> `PERMISSION_DENIED`
