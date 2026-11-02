# 08: Distribute CodeTour readers without admin rights or preinstalled Node.js

**What to build:** A user on a managed Windows or macOS workstation can run the standalone CodeTour CLI and its terminal/HTML Playback Surfaces from a packaged artifact, without administrator privileges or a globally installed JavaScript runtime.

**Blocked by:** 03 — Play a Tour in an independent TermDOM terminal window.

**Status:** ready-for-agent

- [ ] Produce documented, reproducible distributable launch artifacts for Windows x64 and macOS Intel/Apple Silicon wherever the selected runtime permits.
- [ ] A fresh machine without globally installed Node.js/Bun can launch the CLI, discover a Tour, and open the independent terminal reader.
- [ ] All required TermDOM/native and rendering dependencies are bundled or otherwise included without a privileged installer; no extra manual launch step is needed.
- [ ] The package can run without admin permissions subject to local endpoint-security execution policies, which must be clearly documented and not bypassed.
- [ ] Windows and macOS packaging smoke tests exercise actual artifact launch, lifecycle and at least one Tour Step, not only a build-success assertion.
- [ ] Development installs may stay simple; failure to deliver standalone artifacts is recorded as a blocking POC acceptance failure.
