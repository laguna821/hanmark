# Password-protected test document

`HWP5-password-123456.hwpx` is an HWPX file encrypted with ODF AES-256-CBC and PBKDF2.
Its open password is `123456`. HanMark uses it to test the import flow
"ENCRYPTED → enter password → note created" and that a wrong password is not
reported as success.

- Source: rhwp `samples/` (<https://github.com/edwardkim/rhwp>), as redistributed in
  the Kordoc repository's `tests/fixtures/password/`.
- Copyright: edwardkim (rhwp). License: MIT. See `THIRD_PARTY_NOTICES.md`.
- SHA-256: `93e7a62565e0f3efa4feee2812aaf518347dbbcc09d2f26a0d9385f9a4e26060`

The file is test data only. It is not bundled into `main.js`.

## HWP 3.x

`HWP3-password-123456.hwp` is an HWP 3.x file encrypted with DES-ECB; its open password is
`123456`. HanMark uses it to test that HWP to HWPX conversion asks for the password and
that HWP 3.x converts as text and tables with default formatting (R-034).

- Source and license: as above (rhwp `samples/`, MIT, through the Kordoc repository).
- SHA-256: `db743d084efc9e08e839a5b4d978b16b8676434011776e090e4cda43e57304be`
