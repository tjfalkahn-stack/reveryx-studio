#include "reveryx/native_core.h"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <limits>
#include <sstream>
#include <stdexcept>

namespace reveryx {
namespace {
void ascii(std::ostream& out, const std::string& value, std::size_t width) {
  const auto count = std::min(width, value.size());
  out.write(value.data(), static_cast<std::streamsize>(count));
  for (std::size_t i = count; i < width; ++i) out.put('\0');
}

template <typename T>
void little(std::ostream& out, T value) {
  for (std::size_t i = 0; i < sizeof(T); ++i)
    out.put(static_cast<char>((static_cast<std::uint64_t>(value) >> (i * 8)) & 0xff));
}
}  // namespace

SessionClock::SessionClock(std::uint32_t sample_rate) : sample_rate_(sample_rate) {
  if (sample_rate_ == 0) throw std::invalid_argument("sample rate must be positive");
}

std::uint64_t SessionClock::samples_for_seconds(double seconds) const {
  if (seconds <= 0.0) return 0;
  return static_cast<std::uint64_t>(std::llround(seconds * sample_rate_));
}

double SessionClock::seconds_for_samples(std::uint64_t samples) const {
  return static_cast<double>(samples) / sample_rate_;
}

std::uint32_t SessionClock::sample_rate() const { return sample_rate_; }

RecoveryJournal::RecoveryJournal(std::filesystem::path path) : path_(std::move(path)) {}

void RecoveryJournal::append(const TakeRecord& take) const {
  std::ofstream out(path_, std::ios::app);
  if (!out) throw std::runtime_error("could not open recovery journal");
  out << take.id << '\t' << take.state << '\t' << take.start_sample << '\t' << take.frames << '\n';
  out.flush();
  if (!out) throw std::runtime_error("could not commit recovery journal");
}

std::vector<TakeRecord> RecoveryJournal::recover() const {
  std::vector<TakeRecord> recovered;
  std::ifstream in(path_);
  if (!in) return recovered;
  std::string line;
  while (std::getline(in, line)) {
    std::istringstream row(line);
    TakeRecord take;
    if (std::getline(row, take.id, '\t') && std::getline(row, take.state, '\t') &&
        row >> take.start_sample && row.get() == '\t' && row >> take.frames)
      recovered.push_back(std::move(take));
  }
  return recovered;
}

void write_bwf_pcm24(const std::filesystem::path& path,
                     const std::vector<std::int32_t>& samples,
                     std::uint16_t channels,
                     std::uint32_t sample_rate,
                     std::uint64_t time_reference,
                     const std::string& description) {
  if (channels == 0 || sample_rate == 0 || samples.size() % channels != 0)
    throw std::invalid_argument("invalid BWF format");
  constexpr std::uint32_t bext_size = 602;
  constexpr std::uint32_t fmt_size = 16;
  const auto data_size = static_cast<std::uint32_t>(samples.size() * 3);
  const std::uint32_t riff_size = 4 + 8 + bext_size + 8 + fmt_size + 8 + data_size;
  std::ofstream out(path, std::ios::binary | std::ios::trunc);
  if (!out) throw std::runtime_error("could not create BWF");

  ascii(out, "RIFF", 4); little(out, riff_size); ascii(out, "WAVE", 4);
  ascii(out, "bext", 4); little(out, bext_size);
  ascii(out, description, 256); ascii(out, "REVERYX Native Core", 32); ascii(out, "REVERYX", 32);
  ascii(out, "1970-01-01", 10); ascii(out, "00:00:00", 8);
  little(out, static_cast<std::uint32_t>(time_reference & 0xffffffff));
  little(out, static_cast<std::uint32_t>(time_reference >> 32));
  little(out, static_cast<std::uint16_t>(1));
  for (int i = 0; i < 64 + 190; ++i) out.put('\0');

  ascii(out, "fmt ", 4); little(out, fmt_size); little(out, static_cast<std::uint16_t>(1));
  little(out, channels); little(out, sample_rate); little(out, sample_rate * channels * 3);
  little(out, static_cast<std::uint16_t>(channels * 3)); little(out, static_cast<std::uint16_t>(24));
  ascii(out, "data", 4); little(out, data_size);
  for (auto sample : samples) {
    const auto clipped = std::clamp(sample, -8388608, 8388607);
    const auto value = static_cast<std::uint32_t>(clipped);
    out.put(static_cast<char>(value & 0xff));
    out.put(static_cast<char>((value >> 8) & 0xff));
    out.put(static_cast<char>((value >> 16) & 0xff));
  }
  if (!out) throw std::runtime_error("could not finalize BWF");
}

}  // namespace reveryx
