import { describe, expect, test } from 'bun:test';
import { convertOrtIdToPurl } from './id.ts';

describe('convertOrtIdToPurl', () => {
  test('converts NPM package without namespace', () => {
    expect(convertOrtIdToPurl('NPM::lodash:4.17.21')).toBe('pkg:npm/lodash@4.17.21');
  });

  test('converts Maven package with namespace', () => {
    expect(convertOrtIdToPurl('Maven:org.example:my-lib:1.0.0')).toBe('pkg:maven/org.example/my-lib@1.0.0');
  });

  test('converts PyPI package', () => {
    expect(convertOrtIdToPurl('PyPI::requests:2.31.0')).toBe('pkg:pypi/requests@2.31.0');
  });

  test('converts Go package', () => {
    expect(convertOrtIdToPurl('Go::github.com/pkg/errors:0.9.1')).toBe('pkg:golang/github.com%2Fpkg%2Ferrors@0.9.1');
  });

  test('converts GoMod to golang type', () => {
    expect(convertOrtIdToPurl('GoMod::golang.org/x/text:0.14.0')).toBe('pkg:golang/golang.org%2Fx%2Ftext@0.14.0');
  });

  test('converts Gradle to maven type', () => {
    expect(convertOrtIdToPurl('Gradle:com.google:gson:2.10.1')).toBe('pkg:maven/com.google/gson@2.10.1');
  });

  test('converts Crate (Cargo package type) to cargo', () => {
    expect(convertOrtIdToPurl('Crate::serde:1.0.0')).toBe('pkg:cargo/serde@1.0.0');
  });

  test('converts Pod (CocoaPods package type) to cocoapods', () => {
    expect(convertOrtIdToPurl('Pod::Alamofire:5.8.0')).toBe('pkg:cocoapods/Alamofire@5.8.0');
  });

  test('converts Bundler project type to gem', () => {
    expect(convertOrtIdToPurl('Bundler::Gemfile:')).toBe('pkg:gem/Gemfile');
  });

  test('converts SBT to maven type', () => {
    expect(convertOrtIdToPurl('SBT:org.scala-lang:scala-library:2.13.10')).toBe(
      'pkg:maven/org.scala-lang/scala-library@2.13.10',
    );
  });

  test('converts Tycho to maven type', () => {
    expect(convertOrtIdToPurl('Tycho:org.example:bundle:1.0.0')).toBe('pkg:maven/org.example/bundle@1.0.0');
  });

  test('converts Stack to hackage type', () => {
    expect(convertOrtIdToPurl('Stack::aeson:2.1.0.0')).toBe('pkg:hackage/aeson@2.1.0.0');
  });

  test('converts Hackage package type to hackage', () => {
    expect(convertOrtIdToPurl('Hackage::aeson:2.1.0.0')).toBe('pkg:hackage/aeson@2.1.0.0');
  });

  test('converts SwiftPM project type to swift', () => {
    expect(convertOrtIdToPurl('SwiftPM:github.com/example:MyApp:1.0.0')).toBe(
      'pkg:swift/github.com/example/MyApp@1.0.0',
    );
  });

  test('converts Swift package type to swift', () => {
    expect(convertOrtIdToPurl('Swift:github.com/Alamofire:Alamofire:5.8.0')).toBe(
      'pkg:swift/github.com/Alamofire/Alamofire@5.8.0',
    );
  });

  test('converts Gleam to otp', () => {
    expect(convertOrtIdToPurl('Gleam::my_app:0.1.0')).toBe('pkg:otp/my_app@0.1.0');
  });

  test('converts Hex package type to hex', () => {
    expect(convertOrtIdToPurl('Hex::ecto:3.10.0')).toBe('pkg:hex/ecto@3.10.0');
  });

  test('converts OTP package type to otp', () => {
    expect(convertOrtIdToPurl('OTP::my_dep:1.0.0')).toBe('pkg:otp/my_dep@1.0.0');
  });

  test('converts lowercase otp project type (Mix/Rebar3) to otp', () => {
    expect(convertOrtIdToPurl('otp::my_app:0.1.0')).toBe('pkg:otp/my_app@0.1.0');
  });

  test('converts PIP project type to pypi', () => {
    expect(convertOrtIdToPurl('PIP::myproject:1.0.0')).toBe('pkg:pypi/myproject@1.0.0');
  });

  test('converts Pipenv project type to pypi', () => {
    expect(convertOrtIdToPurl('Pipenv::myproject:1.0.0')).toBe('pkg:pypi/myproject@1.0.0');
  });

  test('converts Poetry project type to pypi', () => {
    expect(convertOrtIdToPurl('Poetry::myproject:1.0.0')).toBe('pkg:pypi/myproject@1.0.0');
  });

  test('converts PNPM/Yarn/Yarn2 project types to npm', () => {
    expect(convertOrtIdToPurl('PNPM::myapp:1.0.0')).toBe('pkg:npm/myapp@1.0.0');
    expect(convertOrtIdToPurl('Yarn::myapp:1.0.0')).toBe('pkg:npm/myapp@1.0.0');
    expect(convertOrtIdToPurl('Yarn2::myapp:1.0.0')).toBe('pkg:npm/myapp@1.0.0');
  });

  test('converts Bazel/Bower/Carthage/Conan via explicit map', () => {
    expect(convertOrtIdToPurl('Bazel::rules_python:0.1.0')).toBe('pkg:bazel/rules_python@0.1.0');
    expect(convertOrtIdToPurl('Bower::jquery:3.6.0')).toBe('pkg:bower/jquery@3.6.0');
    expect(convertOrtIdToPurl('Carthage::Alamofire:5.0.0')).toBe('pkg:carthage/Alamofire@5.0.0');
    expect(convertOrtIdToPurl('Conan::zlib:1.2.13')).toBe('pkg:conan/zlib@1.2.13');
  });

  test('returns id as-is for invalid format', () => {
    expect(convertOrtIdToPurl('invalid')).toBe('invalid');
  });
});
