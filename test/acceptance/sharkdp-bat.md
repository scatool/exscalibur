# sharkdp/bat native acceptance

Pinned commit `cd06fe46e001483115273e1a03f448720b945948`, tree `e21126a6a3be9d2476b2aa48fb2202bbbe1ecb4a`, source archive SHA-256 `f104f18ada24afee1a42f54cf6b3025439c53549c982d2b7c721f32618e7a788`. Independent verification checked the complete exported superproject source; gitlinks, where present, are explicitly bounded below.

Tools: Go 1.26.3 (linux/amd64), Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. Go ran with `GOTOOLCHAIN=local` and external module/build caches; no toolchain auto-upgrade or source modification.

## Input evidence

- `.gitmodules` — SHA-256 `ecf6b75b930304fad366326f081bfde9445121f6f1e7deb98654cc06eea40735`.
- `Cargo.lock` — SHA-256 `a5fb560b914f86c94e28a707d73fa8987c49dd90b544ecbcf8aeb5ee022f575a`.
- `tests/syntax-tests/highlighted/Go/go.mod` — SHA-256 `2c34dc425082c4096dc8732ce4fb3028ea0d42d6f6d28116cfe8e5fd079453c1`.
- `tests/syntax-tests/highlighted/Go/go.sum` — SHA-256 `cdfd62204b04c72f07b9e4872b2f6b12febdfc606ae8fd74a283a92d54bd75f4`.
- `tests/syntax-tests/highlighted/Requirements.txt/requirements.txt` — SHA-256 `63cda78fd3d8822921336d38255fba70360f39c1d5016a1055262f70fafbc208`.
- `tests/syntax-tests/source/Go/go.mod` — SHA-256 `ecc06f109fc5961333d70f5e580dca947c92a3327a23b6438aa80a53e3c81e5d`.
- `tests/syntax-tests/source/Go/go.sum` — SHA-256 `9e1f2fd573f178f2583231d48eaa5c69c15d73e23eb383aa8d7c9523a8cca8f8`.
- `tests/syntax-tests/source/Requirements.txt/requirements.txt` — SHA-256 `093936836319ed9d02cadd1f4ab6239d553e07f468f5a778dddfeb79c75f54d4`.

## Native comparisons

Native Go1.26.3 commands go mod edit -json, go list -m -json all and go mod graph succeeded for all 1 valid module inputs; 8 selected module placements were compared directly against native output.

Each exact Go project has separate direct, indirect and build-list roots. Every selected module, replacement, requested version and selected-owner graph adjacency matches native command evidence; package adjacency and nonempty closure stay unknown because a module graph does not establish package import/runtime usage.

All sixteen configured extractors ran, yielding 5 independent graphs, 4 roots, 545 edges, 255 catalog identities and 2 exact projects.

Native source hashes remained unchanged after commands and extraction. Go module cache and build cache are external to the pinned sources. Module proxy access succeeded; no environmental failure was accepted as a fixture issue.

Stable module selection facts exclude host cache paths and cache hydration metadata. The same Bat source was compared before and after downloading its selected golang.org/x/tools module: go list gained a local Dir field, which must not change the serialized observation.

The ANSI-highlighted Go and requirements fixtures retain explicit core.file_extraction_failed ERROR observations with unknown coverage. The two requirements options remain warnings, while all 28 native declaration lines and marker conditions are retained without fabricated resolution.

The requirements source hash above is unchanged. Its line 25 declares `requests [security,tests] >= 2.8.1, == 2.8.* ; python_version < "2.7"` before an inline comment. Independent local Python `packaging` 25.0 parsing confirms the name `requests`, extras `security` and `tests`, and the unchanged Python-version marker. The corrected baseline adds only these two requested features and updates that observation's content-derived graph ID; it does not assert that extras were resolved or activated. The explicit assertion in `test/go-acceptance.test.ts` covers this whitespace-before-extras case. The preceding accepted format 2 baseline SHA-256 was `832b58f71654caece2f93c7928f469929efba917d43409ffe2ef39f0542cb3f1`; the historical V1 hash remains unchanged in the migration ledger.

Every Cargo lock record, checksum and dependency reference was compared against raw TOML. Cargo roots remain unknown and no workspace/project scope is inferred.

Scope is the pinned superproject only: all 884 superproject file bytes and modes plus all 91 gitlink records were independently verified; submodule contents are absent and not claimed as analyzed.

Reproducible checks in `test/go-acceptance.test.ts` rerun native commands and compare selected modules, all scoped requests, build-list membership, retained unknown adjacency and mixed-language source inputs. Native Go tests separately exercise basic, monorepo and replacement fixtures. Acceptance does not establish installed packages or deployed artifacts, and the V1 baseline was not used as a semantic oracle.

## Unmaterialized gitlinks

No submodule was fetched. These exact superproject gitlinks remain outside the analyzed scope.

| Path                                              | Commit                                     |
| ------------------------------------------------- | ------------------------------------------ |
| `assets/syntaxes/01_Packages`                     | `759d6eed9b4beed87e602a23303a121c3a6c2fb3` |
| `assets/syntaxes/02_Extra/AWK`                    | `e23926eca1b6a0bd0b572b7191aead9f77c748d1` |
| `assets/syntaxes/02_Extra/Ada`                    | `3f17c2363e10cbfe9c66c4c56953c5aaf48d4448` |
| `assets/syntaxes/02_Extra/Apache`                 | `c438c352db7dd59c7bc0849134b1bab9b338a36e` |
| `assets/syntaxes/02_Extra/AsciiDoc`               | `e316a0a85c67c3edb73a46fc3a3ec4a9dfbbba40` |
| `assets/syntaxes/02_Extra/Assembly_(ARM)`         | `08f33d80ded128a708d83017148dba52ebdfb04a` |
| `assets/syntaxes/02_Extra/CFML`                   | `b91c44a32e251c20c6359a8d9232287e1b408e6c` |
| `assets/syntaxes/02_Extra/CMake`                  | `2560a080b3b7dcdb05e17ee85b2171776e84b8c1` |
| `assets/syntaxes/02_Extra/CoffeeScript`           | `e08f9b8cdfc84e0456ae63dca7aaefb94bf06e24` |
| `assets/syntaxes/02_Extra/Crontab`                | `54f1fa7ff0c9d18aea3790555dba6e533ce3749b` |
| `assets/syntaxes/02_Extra/Crystal`                | `eb63666f35c259733d4c7fcec9adbd82e5a91dda` |
| `assets/syntaxes/02_Extra/Dart`                   | `2734901b014191f5a7f71c3f48678adf31239098` |
| `assets/syntaxes/02_Extra/Docker`                 | `0f6b7bc87acf684f7b0790fd480731ffb4615b87` |
| `assets/syntaxes/02_Extra/DotENV`                 | `58201ba2abbbe6a12b2f6d0595efea3b388c1e38` |
| `assets/syntaxes/02_Extra/Elixir`                 | `4fb01891dd17434dde42887bc821917a30f4e010` |
| `assets/syntaxes/02_Extra/Elm`                    | `e266d279c8074aa342f106554cfa87ebe839a782` |
| `assets/syntaxes/02_Extra/Email`                  | `e89d09d440f342b753a490918f2c9777c64836b3` |
| `assets/syntaxes/02_Extra/FSharp`                 | `9e4645c6085871d6fe4ae8dbcbafe93cb155b074` |
| `assets/syntaxes/02_Extra/Fish`                   | `ef510fd7592186d3c7f6aa066986c047ec29fe81` |
| `assets/syntaxes/02_Extra/Fortran`                | `dcf4f24f1cecd9eebf6b1eb388e4f5db671a7b08` |
| `assets/syntaxes/02_Extra/GDScript-sublime`       | `96f5dcf29728aa987123321e2544330eed991a3e` |
| `assets/syntaxes/02_Extra/GLSL`                   | `59a5f8a3120358657cefdc4b830b4a883ebfbf77` |
| `assets/syntaxes/02_Extra/Gomod`                  | `e0200f024a394d6e7d6b7b37a070bb8ef324b19b` |
| `assets/syntaxes/02_Extra/GraphQL`                | `9b6f6d0a86d7e7ef1d44490b107472af7fb4ffaf` |
| `assets/syntaxes/02_Extra/Groff`                  | `651091c7e266e05c0a529b137b6efd43d717894c` |
| `assets/syntaxes/02_Extra/HTML_(Twig)`            | `aedf955eba9753554815b2cbef5e072415e42068` |
| `assets/syntaxes/02_Extra/INI`                    | `8dd3e316ada5cc8bffd3982bc2a9384345729f34` |
| `assets/syntaxes/02_Extra/Idris2`                 | `bbfe50e023e0edc74f5e0c003eb946528d49279f` |
| `assets/syntaxes/02_Extra/JavaScript_(Babel)`     | `f4579f9107996c16208466248a85dc2296083a5f` |
| `assets/syntaxes/02_Extra/Jinja2`                 | `e572427f6ac5f71fa2b9cf93e976a99bff4a3e94` |
| `assets/syntaxes/02_Extra/Jsonnet`                | `56ac0e6854ad75b26961bee82896af7a61c6a40e` |
| `assets/syntaxes/02_Extra/Julia`                  | `3366b10be91aaab7a61ae0bc0a5af5cc375e58d1` |
| `assets/syntaxes/02_Extra/Kotlin`                 | `aeeed2780b04aea3d293c547c24cae27cafef0c5` |
| `assets/syntaxes/02_Extra/LESS`                   | `836b47ec61a9c6a6445b4007e8353337fe63e2c9` |
| `assets/syntaxes/02_Extra/LLVM`                   | `274126faa9febfb649981cc97ecd499fcd7f5b90` |
| `assets/syntaxes/02_Extra/Lean`                   | `514362b5c7fdcd7c43562d833fb94ff973d1da29` |
| `assets/syntaxes/02_Extra/MediaWiki`              | `5dceaa9dd9af0d2266f1c9e45966d8a610226213` |
| `assets/syntaxes/02_Extra/NSIS`                   | `619a65a04efbf343bdfcde875700675b9b273368` |
| `assets/syntaxes/02_Extra/Nginx`                  | `65f5a63c0d1760c5db2264e50e3b14a7a4567cc0` |
| `assets/syntaxes/02_Extra/Ninja`                  | `25830aaec9316b7fca6600000535214164525d7a` |
| `assets/syntaxes/02_Extra/Nix`                    | `48c497c709c66a2fb118c534a8de8e4e1c4c401d` |
| `assets/syntaxes/02_Extra/Org_mode`               | `bb6e5d848151135ab8f87bdcb997437b2308718a` |
| `assets/syntaxes/02_Extra/PowerShell`             | `a08b55bf1146c210f58e844be53c2aa78fd5e610` |
| `assets/syntaxes/02_Extra/Protobuf`               | `1365331580b0e4bb86f74d0c599dccc87e7bdacb` |
| `assets/syntaxes/02_Extra/Puppet`                 | `2a224343d2151b2896b6d9c48343919c06d1e695` |
| `assets/syntaxes/02_Extra/PureScript`             | `5acebc18503697be09df047591964e68e80fcf8e` |
| `assets/syntaxes/02_Extra/QML`                    | `e3e058a21f3c44d64ef5eda93925ee84169b62ec` |
| `assets/syntaxes/02_Extra/Racket`                 | `7df4479c079768edd994b20052761152e277af21` |
| `assets/syntaxes/02_Extra/Robot`                  | `fcd3323b5631d4abe61e8e8c728d0f4329640a64` |
| `assets/syntaxes/02_Extra/SCSS_Sass`              | `d3d94046409db6fbbc9d51dea52b589ecc9d3d48` |
| `assets/syntaxes/02_Extra/SLS`                    | `f8a8cf90b1185acb63127dfdfe53379a6a16c0fd` |
| `assets/syntaxes/02_Extra/Slim`                   | `cad02689b6c6e03d67dab8eaadb22cf0fd3b436b` |
| `assets/syntaxes/02_Extra/SmartVHDL`              | `b45507ddc8a417b84872a1f28388f9650851fca5` |
| `assets/syntaxes/02_Extra/Strace`                 | `3ec51e0bca39bf60cab7f96cecfc5d003c3ea59b` |
| `assets/syntaxes/02_Extra/Stylus`                 | `30908e3b5757d6cab4bf2ce660ef89b0c614cf62` |
| `assets/syntaxes/02_Extra/SublimeEthereum`        | `b60e0a3e00e68263fcf35ba1a2e0bd0f6e3544f9` |
| `assets/syntaxes/02_Extra/SublimeJQ`              | `84770c52bd0d6cea73bd41299a2770ee931320bc` |
| `assets/syntaxes/02_Extra/Svelte`                 | `c71f1290b061c79c027b5eb002ed06aa6d874ffe` |
| `assets/syntaxes/02_Extra/Swift`                  | `fef17119ceef28a3c4b8cf72268d6192b595365d` |
| `assets/syntaxes/02_Extra/SystemVerilog`          | `b340f1c7f6a38d4da9f77be5abd6d455e5da7641` |
| `assets/syntaxes/02_Extra/TOML`                   | `f5a57e8bff694a4e6c52a491dae579aabc7427cf` |
| `assets/syntaxes/02_Extra/Terraform`              | `54d8350c3c5929c921ea7561c932aa15e7d96c48` |
| `assets/syntaxes/02_Extra/TodoTxt`                | `071a004217f981152c78dc7a530536374a753d98` |
| `assets/syntaxes/02_Extra/TypeScript`             | `ba45efd058df5111837e30fb9598cfc8cbd51095` |
| `assets/syntaxes/02_Extra/Verilog`                | `532e87c1b40114be14ccfe382a141247daa54be4` |
| `assets/syntaxes/02_Extra/VimL`                   | `fe5bf5ea7055b35035438c64d822aae1f1dfdb41` |
| `assets/syntaxes/02_Extra/Vue`                    | `6eb71bc6bba5e6a284b6d1d3154484da6f366e21` |
| `assets/syntaxes/02_Extra/Zig`                    | `c16d871ccccb3749f5a4b824f3fd44b143114565` |
| `assets/syntaxes/02_Extra/cmd-help`               | `273cb988177e96f4187e06008b13fa72ad22ae4d` |
| `assets/syntaxes/02_Extra/gnuplot`                | `04743470ff90237ba3fb34ccf77c2d256d611262` |
| `assets/syntaxes/02_Extra/hosts`                  | `60ed92c472dc6038a13a38d033bba6bc64fd6913` |
| `assets/syntaxes/02_Extra/http-request-response`  | `93b93261bcd8b4fbb38d7e92d3cf3734f0814e31` |
| `assets/syntaxes/02_Extra/ssh-config`             | `bf49e9181c6bf992a86beb133144d2651e826ddc` |
| `assets/syntaxes/02_Extra/sublime-odin`           | `5d6a0ed41e41ec3709ec74f40686dc3761d6596e` |
| `assets/syntaxes/02_Extra/typst-syntax-highlight` | `363f0e767c938c615a14912c302db7936f025fc2` |
| `assets/syntaxes/02_Extra/varlink`                | `04f30d4b831232ea23ffceb5b2da61e12dae5db6` |
| `assets/syntaxes/02_Extra/vscode-wgsl`            | `acf26718d7a327377641e31d8f9a9dab376efa84` |
| `assets/themes/1337-Scheme`                       | `ca6a329cfda8307449d405b70f8fab34b8fd23b5` |
| `assets/themes/Catppuccin`                        | `ccf194fdc9322d3566a7a178817763434c0dd088` |
| `assets/themes/Coldark`                           | `e44750b2a9629dd12d8ed3ad9fd50c77232170b9` |
| `assets/themes/DarkNeon`                          | `174bd535dafffd68df7a6a8fd21312aff32600a4` |
| `assets/themes/Nord-sublime`                      | `bf92a9e4457dc2f97efebc59bbeac95933ec6515` |
| `assets/themes/Solarized`                         | `87e01090cf5fb821a234265b3138426ae84900e7` |
| `assets/themes/TwoDark`                           | `8e0f6fa5b59d196658a22288f519fd8320de4c87` |
| `assets/themes/dracula-sublime`                   | `d490b57c08f3d110ff61a07ec6edcc1ed9e24a63` |
| `assets/themes/github-sublime-theme`              | `59e525f638237dca56f728d7e5d38b9bb41c56d4` |
| `assets/themes/gruvbox`                           | `40503472826e51d87666e548a0634c4f1d74938c` |
| `assets/themes/onehalf`                           | `141c775ace6b71992305f144a8ab68e9a8ca4a25` |
| `assets/themes/sublime-monokai-extended`          | `0ca4e75291515c4d47e2d455e598e03e0dc53745` |
| `assets/themes/sublime-snazzy`                    | `48f43a735037195021fa69d99c1180bf12f38f78` |
| `assets/themes/zenburn`                           | `4f217457230ff5f31d594b0e20474b69294988d4` |
