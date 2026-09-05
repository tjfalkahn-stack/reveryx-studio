# REVERYX Native Core Alpha

This is the portable, dependency-free foundation for the macOS and Windows recording engine. It establishes three contracts that browser capture cannot guarantee on its own:

- sample-positioned takes on a monotonic session clock;
- 48 kHz, 24-bit Broadcast WAV files with a BWF time reference;
- an append-only recovery journal that can reconstruct the latest safe session state after a crash.

The current target is a tested core library, not a signed desktop application. The next layer connects this core to CoreAudio on macOS and ASIO/WASAPI on Windows, then exposes the local status endpoint at `127.0.0.1:49173` and the `reveryx://` session handoff protocol used by the web interface.

Build and test:

```sh
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure
```
