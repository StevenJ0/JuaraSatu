# Loopback TLS test fixture

The certificate/key pair is public test data generated only for the local transport integration test. It is never a production credential. SAN matches the SDK host so hostname and certificate verification remain enabled; the test trusts this certificate only on its redirected loopback socket. No trust-store or NODE_TLS_REJECT_UNAUTHORIZED changes.

The test redirects TLS sockets to 127.0.0.1, performs no Google generation, delays the server handshake for 11.2 seconds or never completes it, and restores all hooks afterward.
