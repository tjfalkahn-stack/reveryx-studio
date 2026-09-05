#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace reveryx {

class SessionClock {
 public:
  explicit SessionClock(std::uint32_t sample_rate = 48000);
  std::uint64_t samples_for_seconds(double seconds) const;
  double seconds_for_samples(std::uint64_t samples) const;
  std::uint32_t sample_rate() const;

 private:
  std::uint32_t sample_rate_;
};

struct TakeRecord {
  std::string id;
  std::string state;
  std::uint64_t start_sample;
  std::uint64_t frames;
};

class RecoveryJournal {
 public:
  explicit RecoveryJournal(std::filesystem::path path);
  void append(const TakeRecord& take) const;
  std::vector<TakeRecord> recover() const;

 private:
  std::filesystem::path path_;
};

void write_bwf_pcm24(const std::filesystem::path& path,
                     const std::vector<std::int32_t>& interleaved_samples,
                     std::uint16_t channels,
                     std::uint32_t sample_rate,
                     std::uint64_t time_reference,
                     const std::string& description);

}  // namespace reveryx
