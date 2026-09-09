# AWS Signature Fix - Testing Strategy

## Overview
This document provides comprehensive testing steps to validate the AWS Signature authentication fixes.

## Test Environment Setup

### Prerequisites
- Hoppscotch running locally or on HTTPS
- AWS credentials (use test/sandbox account if available)
- Browser with Developer Tools
- Network proxy tool (optional, for debugging)

### Test Data
```
Test AWS Access Key ID: AKIAIOSFODNN7EXAMPLE
Test AWS Secret Key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
Region: us-east-1
Service: s3
```

---

## Test Cases

### Category 1: UI Validation

#### Test 1.1: Empty Access Key ID Warning
**Steps:**
1. Go to Authorization tab
2. Select AWS Signature auth type
3. Leave Access Key ID empty
4. Leave other required fields empty

**Expected Result:**
- Yellow warning box appears
- Text shows: "Missing required fields: Access Key ID is required, Secret Access Key is required, Service Name is required"
- Required field indicators (*) visible

**Actual Result:** [  ] Pass [ ] Fail

---

#### Test 1.2: Empty Secret Key Warning
**Steps:**
1. Fill in Access Key ID: `AKIAIOSFODNN7EXAMPLE`
2. Leave Secret Key empty
3. Fill in Service Name: `s3`

**Expected Result:**
- Yellow warning shows: "Missing required fields: Secret Access Key is required"
- Warning updates in real-time as user types

**Actual Result:** [  ] Pass [ ] Fail

---

#### Test 1.3: Empty Service Name Warning
**Steps:**
1. Fill in Access Key ID: `AKIAIOSFODNN7EXAMPLE`
2. Fill in Secret Key: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`
3. Leave Service Name empty

**Expected Result:**
- Yellow warning shows: "Missing required fields: Service Name is required"

**Actual Result:** [  ] Pass [ ] Fail

---

#### Test 1.4: All Fields Valid - No Warning
**Steps:**
1. Fill in all required AWS fields with valid test credentials
2. Region: `us-east-1`
3. Service Name: `s3`

**Expected Result:**
- Yellow warning disappears
- All fields display normally

**Actual Result:** [  ] Pass [ ] Fail

---

### Category 2: Request Execution

#### Test 2.1: Successful AWS Signature Request
**Setup:**
1. Use real AWS credentials (S3 read permission minimum)
2. URL: `https://s3.amazonaws.com/`
3. Method: GET
4. Authorization: AWS Signature (all fields filled)

**Expected Result:**
- Request sends successfully
- Response shows S3 bucket list or 403 (if creds lack permission) - NOT "signing failed"
- Progress bar completes
- No error toast

**Actual Result:** [  ] Pass [ ] Fail

**Note:** If you don't have AWS credentials, use a mock S3 endpoint instead.

---

#### Test 2.2: Invalid Credentials Error Message
**Setup:**
1. URL: `https://s3.amazonaws.com/`
2. Access Key ID: `AKIAIOSFODNN7INVALID`
3. Secret Key: `invalid/secret/key`
4. Service Name: `s3`
5. Method: GET

**Expected Result:**
- Request sends
- Response: HTTP 403 Forbidden from AWS (signature is valid but credentials are invalid)
- Error message: "AWS Signature rejected by server: 403 Forbidden"
- Progress bar completes

**Actual Result:** [  ] Pass [ ] Fail

---

#### Test 2.3: Unresolved Environment Variable
**Setup:**
1. Access Key ID: `{{ UNDEFINED_VAR }}`
2. Secret Key: `{{ AWS_SECRET }}`
3. Service Name: `s3`

**Expected Result:**
- Yellow warning: "Missing required fields: Access Key ID is required, Secret Access Key is required"
- Error toast on send: "AWS Signature: Access Key ID is required and cannot be empty"
- Progress bar completes

**Actual Result:** [  ] Pass [ ] Fail

---

### Category 3: Error Handling

#### Test 3.1: WebCrypto Not Available (Non-HTTPS)
**Setup:**
1. Access Hoppscotch on `http://example.com` (not localhost)
2. Fill all AWS fields correctly
3. Try to send

**Expected Result:**
- Error toast: "AWS Signature signing failed: ... WebCrypto is available, and request is over HTTPS or localhost."
- Progress bar completes
- No infinite loading

**Actual Result:** [  ] Pass [ ] Fail

**Note:** This test only applies if Hoppscotch is served over non-secure HTTP. Skip if running on localhost or HTTPS.

---

#### Test 3.2: Loading State Clears on Error
**Setup:**
1. Manually inject error in signing logic (or use invalid creds that fail signing)
2. Send request
3. Watch the progress bar

**Expected Result:**
- Progress bar shows
- Error message appears within 2 seconds
- Progress bar completes (not stuck)
- Send button returns to "Send" (not "Cancel")

**Actual Result:** [  ] Pass [ ] Fail

---

#### Test 3.3: Timeout Safety Net (30 seconds)
**Setup:**
1. Break the request flow artificially (or use slow network)
2. Send request
3. Wait 30+ seconds
4. Watch browser console

**Expected Result:**
- After ~30 seconds, console shows: "Loading state was not cleared by response. Force-clearing now."
- UI loading state clears
- Send button re-enables

**Actual Result:** [  ] Pass [ ] Fail

**Note:** This is a fallback test. Should only trigger if there's a bug in normal error handling.

---

### Category 4: GraphQL AWS Auth

#### Test 4.1: GraphQL Query with AWS Auth
**Setup:**
1. Create GraphQL request
2. Authorization: AWS Signature
3. Fill all required fields
4. Query: Simple introspection query
5. GraphQL URL: AWS AppSync endpoint (or mock)

**Expected Result:**
- Query executes successfully
- Response shows schema or error from server (not signing error)
- Progress bar completes

**Actual Result:** [  ] Pass [ ] Fail

---

#### Test 4.2: GraphQL Error with Empty AWS Fields
**Setup:**
1. GraphQL request with AWS auth
2. Leave Access Key ID empty
3. Try to query

**Expected Result:**
- Error toast: "AWS Signature: Access Key ID is required and cannot be empty"
- Progress bar completes

**Actual Result:** [  ] Pass [ ] Fail

---

### Category 5: CLI Usage

#### Test 5.1: CLI Request with Valid AWS Auth
**Command:**
```bash
hopp run collection.json --env-file env.json
```

**Setup:**
- Collection with REST request using AWS auth
- Environment file with AWS credentials
- All fields valid and resolved

**Expected Result:**
- Request executes successfully
- CLI shows response
- No hanging process

**Actual Result:** [  ] Pass [ ] Fail

---

#### Test 5.2: CLI Request with Invalid AWS Fields
**Command:**
```bash
hopp run collection.json --env-file env.json
```

**Setup:**
- Collection with REST request using AWS auth
- Environment file missing `AWS_SECRET` variable
- Access Key ID resolves, but Secret Key is undefined

**Expected Result:**
- CLI shows error: "AWS Signature: Secret Access Key is required and cannot be empty"
- Exit code non-zero
- Process completes (not hanging)

**Actual Result:** [  ] Pass [ ] Fail

---

## Browser Developer Tools Verification

### Test 5.3: Console Error Messages
**Steps:**
1. Open browser Developer Tools (F12)
2. Go to Console tab
3. Execute request that fails validation
4. Check console output

**Expected Result:**
- Console shows clear error message
- Message includes actionable hints
- No red X or unhandled promise rejection

**Example Console Output:**
```
AWS Signature signing failed: TypeError: Cannot read properties of undefined (reading 'sign')
AWS Signature signing failed: ... Ensure Access Key ID and Secret Access Key are valid, WebCrypto is available, and request is over HTTPS or localhost.
```

**Actual Result:** [  ] Pass [ ] Fail

---

### Test 5.4: Network Tab
**Steps:**
1. Open browser Developer Tools (F12)
2. Go to Network tab
3. Send a request with AWS auth (failed signature)
4. Check request headers

**Expected Result:**
- If signing failed pre-request: No network request appears (error caught before send)
- If signing succeeded but auth rejected: Network request shows, server returns 403

**Actual Result:** [  ] Pass [ ] Fail

---

## Performance & Edge Cases

#### Test 6.1: Large Access Key/Secret Key
**Setup:**
1. Access Key ID: Very long string (100+ chars)
2. Secret Key: Very long string (1000+ chars)
3. Service Name: Normal (`s3`)

**Expected Result:**
- Request processes normally
- No timeout
- Signing completes in <1 second

**Actual Result:** [  ] Pass [ ] Fail

---

#### Test 6.2: Special Characters in Credentials
**Setup:**
1. Access Key ID: Contains URL-reserved characters
2. Secret Key: Contains all special characters
3. Service Name: Normal

**Expected Result:**
- Request either succeeds or shows proper AWS error (not signing error)
- No URL encoding issues

**Actual Result:** [  ] Pass [ ] Fail

---

#### Test 6.3: Switching Between Auth Types
**Setup:**
1. Request with AWS Signature auth
2. Change Authorization type to "Bearer"
3. Change back to "AWS Signature"
4. Send

**Expected Result:**
- Previous AWS fields are remembered
- Switching doesn't cause errors
- Request sends properly

**Actual Result:** [  ] Pass [ ] Fail

---

## Summary Sheet

| Test ID | Test Name | Status | Notes |
|---------|-----------|--------|-------|
| 1.1 | Empty Access Key Warning | [ ] | |
| 1.2 | Empty Secret Key Warning | [ ] | |
| 1.3 | Empty Service Name Warning | [ ] | |
| 1.4 | All Fields Valid | [ ] | |
| 2.1 | Successful Request | [ ] | Needs real/mock AWS |
| 2.2 | Invalid Credentials | [ ] | Expected: 403 Forbidden |
| 2.3 | Unresolved Env Var | [ ] | |
| 3.1 | WebCrypto Not Available | [ ] | Skip if on localhost/HTTPS |
| 3.2 | Loading State Clears | [ ] | |
| 3.3 | Timeout Fallback | [ ] | Edge case |
| 4.1 | GraphQL Query Success | [ ] | Needs GraphQL endpoint |
| 4.2 | GraphQL Error | [ ] | |
| 5.1 | CLI Valid Auth | [ ] | |
| 5.2 | CLI Invalid Auth | [ ] | |
| 5.3 | Console Messages | [ ] | |
| 5.4 | Network Tab | [ ] | |
| 6.1 | Large Credentials | [ ] | |
| 6.2 | Special Characters | [ ] | |
| 6.3 | Auth Type Switching | [ ] | |

---

## Notes for Testers

1. **Always check the error message** - It should be clear and actionable
2. **Watch the progress bar** - It should always complete (not infinite)
3. **Monitor the console** - Errors should be logged clearly
4. **Test on both localhost and HTTPS** - WebCrypto behaves differently
5. **If test fails** - Provide screenshot + browser console output + exact steps to reproduce
6. **If timeout triggered** - That's a bug; report with details about what caused the hang

