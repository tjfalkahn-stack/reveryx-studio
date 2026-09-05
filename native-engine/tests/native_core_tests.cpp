#include "reveryx/native_core.h"

#include <cassert>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

int main() {
  namespace fs = std::filesystem;
  const reveryx::SessionClock clock(48000);
  assert(clock.samples_for_seconds(1.25) == 60000);
  assert(clock.seconds_for_samples(96000) == 2.0);

  const auto root = fs::temp_directory_path() / "reveryx-native-core-test";
  fs::create_directories(root);
  const auto journal_path = root / "recovery.rvxj";
  fs::remove(journal_path);
  reveryx::RecoveryJournal journal(journal_path);
  journal.append({"take-01", "captured", 60000, 24000});
  journal.append({"take-01", "keep", 60000, 24000});
  const auto recovered = journal.recover();
  assert(recovered.size() == 2);
  assert(recovered.back().state == "keep");
  assert(recovered.back().start_sample == 60000);

  const auto bwf_path = root / "take-01.wav";
  reveryx::write_bwf_pcm24(bwf_path, std::vector<std::int32_t>(960, 1024), 1, 48000, 60000, "Take 01");
  std::ifstream in(bwf_path, std::ios::binary);
  const std::string bytes{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
  assert(bytes.substr(0, 4) == "RIFF");
  assert(bytes.substr(8, 4) == "WAVE");
  assert(bytes.find("bext") != std::string::npos);
  assert(bytes.find("data") != std::string::npos);
  assert(bytes.size() == 12 + 8 + 602 + 8 + 16 + 8 + 960 * 3);
  fs::remove_all(root);
  return 0;
}
