cmake_minimum_required(VERSION 3.20)
project(reveryx_native_core VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(reveryx_native_core
  src/native_core.cpp
)
target_include_directories(reveryx_native_core PUBLIC include)
target_compile_options(reveryx_native_core PRIVATE -Wall -Wextra -Wpedantic)

add_executable(reveryx_native_core_tests tests/native_core_tests.cpp)
target_link_libraries(reveryx_native_core_tests PRIVATE reveryx_native_core)

enable_testing()
add_test(NAME native_core COMMAND reveryx_native_core_tests)
