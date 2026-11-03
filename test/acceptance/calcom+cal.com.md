# calcom/cal.com format 2 acceptance

Exact source commit `71515ad17c88220358249b0ccdf084a193f53f1c`, Git tree `efc5ebc0ddc6a3157ba5138d7707cb2773464f61`, explicit Git archive SHA-256 `ee592a9f116b0e96d638452b6f34105c28580b1a58109aa7f5e128ae9c65eefa`. Source provenance receipts and matching-input SHA-256 values are recorded in `mixed-workspace-sources.json`.

The complete archive source tree was reconstructed from file bytes, executable modes and symlinks and matched the receipt Git tree.

All 16 configured integration extractors executed. The candidate preserves these independently checked native observations:

- `packagejson`: 1 observations.
- `yarnberry`: 2 observations.
- `bunlock`: 1 observations.

Manifest roots enumerate the exact four dependency scopes and preserve native requests. npm placement records, Yarn descriptor maps and pnpm snapshots are compared directly to parsed native tables, including request targets and conservative selection. Yarn effective resolver closure remains unobserved. Bun tuple records, workspace roots, native requests and nearest ancestor placements are checked independently; peers retain uncertain selection. Cargo retains exact raw package records and references, no inferred workspace roots or selected feature closure. The test asserts the complete matched-input inventory and hashes, graph counts, and exact warning/error code, severity and source-file multiset.

Counts: 4422 packages, 137 subprojects, 4 graphs, 10518 nodes, 1233 roots, 27118 edges.

The binary `bun.lockb` is intentionally unsupported: `core.file_extraction_failed` ERROR and an unknown empty observation remain. The 35 unresolved Yarn requests remain visible; they are not synthesized into resolved edges.

Native source inputs:

| Path                                                                         | SHA-256                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/api/package.json`                                                      | `2c5e69121a3398087cb5854fd9cd42aee50b848d14d944ae5729b8eb9b443464` |
| `apps/api/v1/package.json`                                                   | `9636c1b4964acb19e0b3e543f322130d18c9101a57b8e37936056937fbe469e7` |
| `apps/api/v2/package.json`                                                   | `2203ee681158f2e7586913ade8dabcf9a60a830560823a055e391edbdd8d5c8e` |
| `apps/ui-playground/package.json`                                            | `51203bb24cfd4c612528b4a886b0f872fde328af88e4f1540a34af2a2dfd1ab8` |
| `apps/web/package.json`                                                      | `38223558eb9e2988a4e4887dd4b505ef38fc50469958cfb46259d6c41396d4ab` |
| `example-apps/credential-sync/package.json`                                  | `1ed6e1b4a6ef4c25c5c7be2213c3c792a05a1e6eef1559d54eb5bc2325dc604c` |
| `package.json`                                                               | `d2797e90f3246d478c4fb6fbfd9dc675e42030f468451435d0fa9b6b7ab1ab8a` |
| `packages/app-store/alby/package.json`                                       | `4d46de6ef54888c8880a807b602dac9dfb850b81f555f7365ac20ad2a628b608` |
| `packages/app-store/amie/package.json`                                       | `49384892f9e36d669b44343a508aecdc219de271d760b847fca25cf277517cc4` |
| `packages/app-store/applecalendar/package.json`                              | `58378b28d9568d8ef14eb9cc19c35f0d0ddb5157b953732e0da11e371533cb36` |
| `packages/app-store/attio/package.json`                                      | `a9f35c7d59e00263cd2d31a04358f06ae75878fcfca65ee3365dd5dff809c2af` |
| `packages/app-store/autocheckin/package.json`                                | `8c39729067ceb5fb430dbc06900ee7fbe7afa563185011febbab0f97e843f690` |
| `packages/app-store/baa-for-hipaa/package.json`                              | `8a5ca6ac976c1955fba83b3b576e55065a13a6e47ec910280c72f26c1f5d449b` |
| `packages/app-store/basecamp3/package.json`                                  | `4dae73243904f2eaffd75d8d782821670b9fb1d2ecd670b104d353f8fc1c44f7` |
| `packages/app-store/bolna/package.json`                                      | `aaf5ba123fa8494540e9db9377d2de64aaba2f6aac1029f757a43898f6060d0f` |
| `packages/app-store/btcpayserver/package.json`                               | `fa374bd9df4963dab0c396f6fd263ba8108b13e7587daedcda57b634bec4e51d` |
| `packages/app-store/caldavcalendar/package.json`                             | `3b98b80d3c5ed23cc11da957528f2370874ff4e80edc5fed6eba32b446e446c1` |
| `packages/app-store/campfire/package.json`                                   | `92ec53ec1b84c935ab5635d41e508dde9a50dcbde2990c2c6dba1e4109944d89` |
| `packages/app-store/chatbase/package.json`                                   | `d7de9d68e200382f44e9db26cba5284074ae56a38585cfc4acbb07b4152a0bf3` |
| `packages/app-store/clic/package.json`                                       | `ab1011750d5905e596549283558b7f8661be90a9f36284387336a7b237b34ff0` |
| `packages/app-store/closecom/package.json`                                   | `910e1fed6ede8056c15d0df8d5b99a5b561f6b39541ea7c4959607c87b7f8aeb` |
| `packages/app-store/cron/package.json`                                       | `06271891f84ebf4765c6ffd8da5c4752c51752876ecc63d68a5a589f4f09caa8` |
| `packages/app-store/dailyvideo/package.json`                                 | `ba618c99071fa95c6684d6eeb52b2e7b03d15dd3c1e7c818037fdfc95f532883` |
| `packages/app-store/deel/package.json`                                       | `b00dee9648da60bd0a72f427154f3743ab18aebffe36952b1e30b966d3801244` |
| `packages/app-store/demodesk/package.json`                                   | `109ad95e4bcdaceb2b6b73275e24914c2b2e64f8e333cbcf960a22ebf103a8a7` |
| `packages/app-store/dialpad/package.json`                                    | `7028c909cb1ff6b804563cde506ce9c6c9953bd107ef34450f7fdbba24bece72` |
| `packages/app-store/discord/package.json`                                    | `7db5efae0e49d39155ccd7dd471f2ccde31dfb3990479dc40fe30da2cf0a910c` |
| `packages/app-store/dub/package.json`                                        | `08f3a6fc50e61ef656fd036d0bfe98d8c83b5c89739524e57a8e3e53c6d22f17` |
| `packages/app-store/eightxeight/package.json`                                | `4feed1df2b39db86f9dc74fb1abfd62646c1a09cac30e5c4f4142e6e9704e781` |
| `packages/app-store/element-call/package.json`                               | `55e36f53f0de8045a6358b02294c2d112c61867f6f11285f3aa61987434d7323` |
| `packages/app-store/elevenlabs/package.json`                                 | `068b85730c02fb5c9146011b8dc7a053a49ced44b669345a6fc104bd599eae97` |
| `packages/app-store/exchange2013calendar/package.json`                       | `ec0e163fe0df14899594f9a3f114fd76090d4e14ea560278ec5ba3646fde1656` |
| `packages/app-store/exchange2016calendar/package.json`                       | `1610a792d9a901a68c8156c80d6b5c8714bbecd191efa7e782eac76abaa6e441` |
| `packages/app-store/exchangecalendar/package.json`                           | `2e1f0d00214f9281be5cabfa7ce81ea107c9c034a547444161680e8d2cc1025d` |
| `packages/app-store/facetime/package.json`                                   | `c991b0690be8f2a1cea6d08f40a0601ba926c27a3eb2a7f02e3f89ce30b9f6cb` |
| `packages/app-store/fathom/package.json`                                     | `c8c8c2c9cb426d00bf134e4999946964896aaccbcf8cf3497e0304fd1e4b4a3a` |
| `packages/app-store/feishucalendar/package.json`                             | `912b7f508cef43a3841a1d91f1b78b15c40d9c049f789309816265b46610472a` |
| `packages/app-store/fonio-ai/package.json`                                   | `046170232ee2d0c256ac8029afb8280b0f68809628f66b61bcf3156bbce65128` |
| `packages/app-store/framer/package.json`                                     | `2718245e4690fa2f183ec0b9a436b42982dc984b0bb9bb83fac20a0d62d74014` |
| `packages/app-store/ga4/package.json`                                        | `b9d100bd66b061af741a5d0cb915de5820459541c65ddcaecdd4e3ea7707cbb3` |
| `packages/app-store/giphy/package.json`                                      | `85877e143fe8de675afcb2c747714db793d839255da0160038e64ebeeef38a4b` |
| `packages/app-store/googlecalendar/package.json`                             | `f7f7c594c97bcd5ba22a72dd6ffff1c61aa4164bb13906e8bf581285c91fce25` |
| `packages/app-store/googlevideo/package.json`                                | `2085ee87f6912566f8a1cd6adddf83f3150eb809b2ba86fed30bd572991b0aa5` |
| `packages/app-store/granola/package.json`                                    | `e24ad7f0fd575293222e0495f02f3995bf42436012c2c1e6523e13c103a41d02` |
| `packages/app-store/greetmate-ai/package.json`                               | `783379dc2d9f435bf1620a0ab5ea85abee684898a3ea4a3600ab2555f51a1136` |
| `packages/app-store/gtm/package.json`                                        | `b81aedff2f96fc67cfc4cc41155f62812d5f6219084ec22c5ac91ea5f7c6e837` |
| `packages/app-store/hitpay/package.json`                                     | `74e306a4e7df5a1060ce66b6d9dede1d0b1084985a0e70c35be025a871adb6e7` |
| `packages/app-store/horizon-workrooms/package.json`                          | `e51293d0bbdbffb1dd475a5d261dc994e8fdee3eda08ced4d85be76a1b8feacf` |
| `packages/app-store/hubspot/package.json`                                    | `1c2b6c1723117ae4d09e4cbfa8cd3db4cfde31f189767e7c2b0f9ca8fa78ed45` |
| `packages/app-store/huddle01video/package.json`                              | `1bac110a12ad7f424e496aac4251a2ebaa9d2990d9b5c6889763c614bc677ab5` |
| `packages/app-store/ics-feedcalendar/package.json`                           | `202f13ba52a1c8f51276fb107f56ba4cf390907aec36dc2bf739fb94516012c0` |
| `packages/app-store/insihts/package.json`                                    | `1eb19913606ce5ddfeafd907208458714d4c308879e2365363e9eb63c7953a28` |
| `packages/app-store/intercom/package.json`                                   | `50fb8953a3631fa7260803edb6d0d5d320faebbbaf62bb1eb1cc5e941fb9a354` |
| `packages/app-store/jelly/package.json`                                      | `60c6e2b277e871b465b3a53f99d517dad861db4ad0dbac4254ec978aeb19efed` |
| `packages/app-store/jitsivideo/package.json`                                 | `aad3e45ddeae59ac4a3614208073ac30633005c0d559013a9518a655ec2a969b` |
| `packages/app-store/larkcalendar/package.json`                               | `c7baaa5e0490ade4633fae9fc302cd86021ac3c26cccbc6e1f8bfedf880a00de` |
| `packages/app-store/lindy/package.json`                                      | `25eee6ceb399eb7a055354b82c4760a6a3c2e297a30c0280eb5de6a895e0bab1` |
| `packages/app-store/linear/package.json`                                     | `5c0ddbcd34a20f68bce3cffa731097533863b8051fa2c86d342661e3173f5f71` |
| `packages/app-store/make/package.json`                                       | `950839c9b732a6746c93bfa8e20f4606b7ecd20000fbb0d6c701294f35ced3e1` |
| `packages/app-store/matomo/package.json`                                     | `01b305c567c5c579f294f91426c24b0215766bc03cc598f351973716904c7f20` |
| `packages/app-store/metapixel/package.json`                                  | `3482ac1ee6f81d07f45c77b61ac1d0bbfa9c7b5b79449d9002a390a4ef946d81` |
| `packages/app-store/millis-ai/package.json`                                  | `fde733c21752c5cd19578a9f6f2497c26037284a99e381e0b028c10aa66b3540` |
| `packages/app-store/mirotalk/package.json`                                   | `6e7ee5acce6825539d660a25074fd32a324541d70ede32bf7b83dc64e5d24e55` |
| `packages/app-store/mock-payment-app/package.json`                           | `d31feb28fca1cbd6c6ffc7fa0a6b92cda20e08df24134ceb42cacc12d7521e37` |
| `packages/app-store/monobot/package.json`                                    | `b159af64bb4389fd299d2bcaf1aef001440c85afe9d842f8bafbe52b1144dada` |
| `packages/app-store/n8n/package.json`                                        | `286122bf94a8daf6e05b6366ccc3dcbb321122cda7ac187fad8321d4b844c149` |
| `packages/app-store/nextcloudtalk/package.json`                              | `47c299b9644e960e9aee328665418a065dc9745304f86c691f7e89f2e8df60fd` |
| `packages/app-store/office365calendar/package.json`                          | `3d881c4b4b7508731feaddf50040c8efe7e55314d5671ce5cc081026dac0b224` |
| `packages/app-store/office365video/package.json`                             | `8a8349ba3cea53aae7e1b52d8f222adb02a8fbcd79e0b3407362a1348b01d6be` |
| `packages/app-store/package.json`                                            | `af95e4c12a6726ff9354fc69cfa695b2115bfa242069382c9764d55967c9cd3b` |
| `packages/app-store/paypal/package.json`                                     | `55e34ac4bdfb28de2dbe80e8848dcf6808415adf5ddbf15dac8242e3e980e254` |
| `packages/app-store/ping/package.json`                                       | `34cd482e962ecaf4672c586faa041289bfebb662c94b566f527685835e938823` |
| `packages/app-store/pipedream/package.json`                                  | `25514e7463e37f52e4fe095ac59650f4c658b8ae0623406c4aeb5b7094fe2565` |
| `packages/app-store/pipedrive-crm/package.json`                              | `6a48cf78625729723de25f70f5358dd6ad15b5e036bde6813ec55499917f0b25` |
| `packages/app-store/plausible/package.json`                                  | `f3cf768a7e6e18d50afc4af4b6295014537ffccd2d0e99b5d9b10764a6093150` |
| `packages/app-store/posthog/package.json`                                    | `04e9b3de102a3636d6647aacd28696c0de064a194137562910a09cec566f4734` |
| `packages/app-store/qr_code/package.json`                                    | `02e03ea59100d36b66fdfff0001fc0927aeb9c50f43df25d63c5b8fba957f5a9` |
| `packages/app-store/raycast/package.json`                                    | `94bdd29ebc8e13e4babda95103cb17d1a8e7d02739fa9e5c89b3ef9314748dba` |
| `packages/app-store/retell-ai/package.json`                                  | `b69231162058d593ef134bef0be02e31a427c5d4d8ea6637f9df0808192a47b9` |
| `packages/app-store/riverside/package.json`                                  | `5456691b3c9b2005c58efa24aca1bff9a51d46b0cc9214c34aea97784dbe2805` |
| `packages/app-store/roam/package.json`                                       | `ef380d59a188f5949c97239a94176d1fdaf8ebe8ec775dc39dc407da8d2959b6` |
| `packages/app-store/routing-forms/package.json`                              | `d87dc8463a4962d3bc9c7e63845880925ab645400db4bfcc888a48f4b1e42368` |
| `packages/app-store/salesforce/package.json`                                 | `e3bfd4e66d50efa8bb192787ab01fe9a2ac8117c635934fe84be0f7021867136` |
| `packages/app-store/salesroom/package.json`                                  | `810b81beedec70f07b769bed37dc1ba2183c5c45ea1f024cd8c9e270939e2460` |
| `packages/app-store/sendgrid/package.json`                                   | `b55a00f8a2a684dd4a18a9971436f766a22fe8bcb4e921152e68e31206911fbe` |
| `packages/app-store/shimmervideo/package.json`                               | `5b75d7d883904acb13b27064cfa994efc7e7a3e4d4181add66b3e37b52488abf` |
| `packages/app-store/signal/package.json`                                     | `2ee40e2d7e2618e7adb7c0afa188f8c70da0168e3b3b76080cc51e270cef8dd5` |
| `packages/app-store/sirius_video/package.json`                               | `993515852a132dfb91b139cb41fa9fb8a1b3111e0d419e9baaf87a0b8977a52d` |
| `packages/app-store/skype/package.json`                                      | `81d8a571066a1c049cdf722caa6deea40bf0e627485a6d2c071c397e5b432ee6` |
| `packages/app-store/stripepayment/package.json`                              | `4268da406baa4284e47819c585c76d3dfbcf6136d4b4ecca4da9137086204ad8` |
| `packages/app-store/sylapsvideo/package.json`                                | `82507152f0d32a017898c802a5b36684907043fefe57a1e85f4cc01378d1625b` |
| `packages/app-store/synthflow/package.json`                                  | `88c5e8702a13d5587f615b88a6fac7d32827b7717986ba3aa12705e32d240357` |
| `packages/app-store/tandemvideo/package.json`                                | `83e71051b5c885e3588d32d7f077048b8bc7e56d565ba4b4884df375dcdbea3d` |
| `packages/app-store/telegram/package.json`                                   | `dbb2724b2671399baffa5d42fadc71386c37237f33a2a417432ee966ef6c9592` |
| `packages/app-store/telli/package.json`                                      | `a9dd1b6731ad081685dfc0515ed639e64d7879cb669476a28a4199c4b645eeb0` |
| `packages/app-store/templates/basic/package.json`                            | `f0c64a145cf6e2a1d978fe194ce9bd25dfd7ec5590c528a9c21338847305b2f2` |
| `packages/app-store/templates/booking-pages-tag/package.json`                | `db2ef8c9676014c8b65e520563d95d63b2f78564d3fab2bb9e1763c2c6220377` |
| `packages/app-store/templates/event-type-app-card/package.json`              | `d6b609ac426c9ceb142a9a354789ea0482309d1e279f15c375d0dbbeb0b7a0d8` |
| `packages/app-store/templates/event-type-location-video-static/package.json` | `d9ce3879c5eaa2a04e1bfd26e63f09e3df59fa49c50c99b905bc95eba636a998` |
| `packages/app-store/templates/general-app-settings/package.json`             | `ee2e1fba6c87bb9b3cbb0a4d7a43356dac0e73b9f73615b8d319600213f2f66d` |
| `packages/app-store/templates/link-as-an-app/package.json`                   | `7064e2a28718a1028abca67d6edeb373a10ba5ebb17088012c82868939e6b94f` |
| `packages/app-store/twipla/package.json`                                     | `34ea326af21b6ffe665ea8bd76eac4131c21b33f726d229213cadb16595268d4` |
| `packages/app-store/umami/package.json`                                      | `5bfb85a36b1738d132e0c578f64df9b58e20e706ffe0eb6194086ed0a9ebb653` |
| `packages/app-store/vimcal/package.json`                                     | `d7d54ea2d96a6d0d35b163bc505f1007dc097d98a771e57cf9613a826c14e39d` |
| `packages/app-store/vital/package.json`                                      | `fb71f40311d7e92b18ceb8a4c04140f2b43473f1f31ac380beaded864a67338d` |
| `packages/app-store/weather_in_your_calendar/package.json`                   | `8480c4689a69775bf64eaa60546bb6791d122f3c9ec4229c023ebb08be8dbfe7` |
| `packages/app-store/webex/package.json`                                      | `33bac8a69b9347b54461d677827bac57077d76c0eba29f9adc618d7acda58495` |
| `packages/app-store/whatsapp/package.json`                                   | `9864e5dd923c9b87fde0c99e100740f53f0187c4a87143588078177c78a28916` |
| `packages/app-store/whereby/package.json`                                    | `9bf16fe9766c82183b362e61ea2203b022586e2d0236e6007acf2f148b99c9a4` |
| `packages/app-store/wipemycalother/package.json`                             | `afae9b1ef1a884d7473a0056b255d1cfd8321c2184bcee1504570d4275c29791` |
| `packages/app-store/wordpress/package.json`                                  | `683d967ca8ea3e62b9454c5cd7a69e9d0cbd51b414e93b36c28d0095614d2ffc` |
| `packages/app-store/zapier/package.json`                                     | `a01d4a8a1ff2ea227b0dcd813ce3a602e519678a6b4fb94846aaa7f3f3e2b327` |
| `packages/app-store/zoho-bigin/package.json`                                 | `5ef8cce87f00e2036a4cde4b2a7f69f1ee7f9c54f4607dab38008c4db4b84728` |
| `packages/app-store/zohocalendar/package.json`                               | `41fd37fbda609244c133de5ec74a412ce1a5d8f4021f294b12bb89519bd8fcba` |
| `packages/app-store/zohocrm/package.json`                                    | `9b87d88aa17717b456c9c00eb69199b0cbc145afc1b61a3375c457c8eea48bba` |
| `packages/app-store/zoomvideo/package.json`                                  | `657e59ca35e2bbdb8764e2b4bd5c7f7bafa1a3b5f5ae5c82a3676a95a9ce4ed9` |
| `packages/app-store-cli/package.json`                                        | `bb0d0ca9f8cec900112cf3a6f1ca78f67d377dcbf11a3a14eefb129dfb588231` |
| `packages/config/package.json`                                               | `74508612b8aee37fd9c2bbb5ff5f1787c07a7fe42495b9a716ce43beb546d402` |
| `packages/dayjs/package.json`                                                | `635a6027c1305abd6713c900d1ea004fb8e677a0d403ee9e766d91e8a481b51e` |
| `packages/debugging/package.json`                                            | `d95871cf6dea5920933accd285105935c480d32f609f2d0a485e3f323e0dcdf8` |
| `packages/emails/package.json`                                               | `06534b2ed4dff282432696fa65426257525f371ec63ab44a1d78da8efe4d6bcf` |
| `packages/embeds/embed-core/bun.lockb`                                       | `fbbfd5e21eeac1a3c6ec47448238cbc9ac37c3e7c5ff602ac9046d99e8b0167b` |
| `packages/embeds/embed-core/package.json`                                    | `7533260bc0d167f9452453dbff3961dc18aff993215d02f125f37dbf6bd77583` |
| `packages/embeds/embed-react/package.json`                                   | `a2ad9b3606a39d2aa2f27d37ad547a1dafa814a4e2bf65e356131b0ddbe10f3f` |
| `packages/embeds/embed-snippet/package.json`                                 | `52697c70d9cfab9fde69969b3abf4e7698778226dfa88750bd6ef8bdda6549bb` |
| `packages/eslint-config/package.json`                                        | `38b3502618b3ee8df7e0df4be23c82c38e2c9f7fac982fe17dbadfcaa239ff7f` |
| `packages/eslint-plugin/package.json`                                        | `72ae68ecfd895be1ad790aefbac47ce946ee2d2ae920952ecf26d861483b50ad` |
| `packages/features/auth/package.json`                                        | `1341956ef12fe1e95feca3340f578ae5c31bc19cef44bc35ae026d282bea4f0b` |
| `packages/features/ee/billing/package.json`                                  | `780c644f6ae660a896d78569d792e648b41516fa98e9a4153ae721bf990bfb4d` |
| `packages/features/ee/package.json`                                          | `291a0f335607939fd28f2ad67bb2fbbd0eb249adcbf3eec0602b92d31a06e130` |
| `packages/features/package.json`                                             | `90d7cc9b29f0fc937c819151b65e0f68202352376ad3b00a90400aba921a39a1` |
| `packages/kysely/package.json`                                               | `6ebbea0f9ec960c9a130a572f7c430ea8122a5b7faaf26127960dd526d0196d0` |
| `packages/lib/package.json`                                                  | `4d654859933cfa552b0b57f7ae3fef4fb0cc01da640ef4f3693ab7b23fc50794` |
| `packages/platform/atoms/package.json`                                       | `b5b1d13454c75190b703eb48704b9b65c222badbd2b432217127e07081ecf51e` |
| `packages/platform/constants/package.json`                                   | `52c29c31ae02371f96127a2c07f495489404bc05fa016bfbff1a31130bb3c5b4` |
| `packages/platform/enums/package.json`                                       | `67709872b0d269650df10e3174f676a4d2863e57eb53afdbffd9b15e95ed4c76` |
| `packages/platform/examples/base/package.json`                               | `deb139b50b73c77fe806ea45c0fdf6ba922019325941152a93bf444f675d7abd` |
| `packages/platform/libraries/package.json`                                   | `9c1c6163a3d3c782345119458f9adf51a4cbd8dcc284bb51358f12ba78abc2ff` |
| `packages/platform/types/package.json`                                       | `966783a6ef6e5136e98812a4051d9f51a6291f7062ebba94758cf05f7e8657dd` |
| `packages/platform/utils/package.json`                                       | `224c2bbf70675d138362fb223c11a98a859bc7bb8d2285bbdf92e64466ab3bcc` |
| `packages/prisma/package.json`                                               | `9e9a4a6c7d2b5fb6bef737b8b5707a2744cc1aa73ca290a55257ed864a36d280` |
| `packages/trpc/package.json`                                                 | `de28e6def4b75bd688218fcf4e30e45ec66139fa6d0b91199145d231b6e9b856` |
| `packages/tsconfig/package.json`                                             | `5b29f57d5f5686aa86b8375c756307ba1dbdc6b18b97e1bcee762c19bd96ed15` |
| `packages/types/package.json`                                                | `74fd6554d4810d0f7fee31ed7fdf94dae09f979cc42bc9ae92abb154c5d7db4f` |
| `packages/ui/package.json`                                                   | `6803903000adb3d89a044b894c4fa53eff29b8ae3e83c190d1df3a33b92f0c96` |
| `yarn.lock`                                                                  | `e4d477d6325117aee1afde1d227848219b1fe8fc5ed2ea8bedcf27e49c5ddb97` |

Validation: `vp test run test/mixed-workspaces-acceptance.test.ts`. Independent review is required before the integration ledger accepts this baseline.

## Yarn binding certainty correction

The previous raw descriptor projection could label an unproven effective binding
as selected. Current root resolution policies and known built-in compatibility
patch descriptors now constrain that certainty. This correction preserves the raw
targets and requests instead of claiming to execute Yarn's resolver.

Across the two affected observations, 374 edge records gain explicit
uncertainty evidence (236 root-policy and
138 compatibility-patch records); 374 selections change to unknown.
311 source-node coverage/evidence records change. Source-node coverage remains
unknown even if another selected path reaches the same raw target, because its
effective outgoing dependency closure has not been established.

The inspected root selectors are:

- `@apidevtools/json-schema-ref-parser`
- `@types/node`
- `@types/react`
- `@types/react-dom`
- `dayjs@1.11.2`
- `dayjs@^1.8.29`
- `import-in-the-middle`
- `libphonenumber-js`

Compatibility evidence is limited to same-identity wrapped descriptors with the
known `optional!builtin<compat/name>` or older `~builtin<compat/name>` forms.
Unrelated manual patches and alias wrappers do not taint ordinary bindings.
Native Yarn 4.10.3 preparation independently verifies representative overrides
and compatibility rewrites; the older Berry hooks were inspected for their
legacy marker and literal-comparison behavior. Normalized policy matching is
conservative for older Berry, not proof every policy was applied. Classic Yarn
ancestor paths are absent from lock records, so target-name policy matches remain
uncertain rather than inventing an issuer path. No installation or full effective
resolution is asserted.

The full sixteen-extractor capture preserves catalog, projects, roots, raw
bindings/requests/native records, optional/platform conditions, issues and source
hashes. Only targeted uncertainty, supporting evidence, source-node coverage and
content-derived graph IDs change. Permanent acceptance assertions check each
reported uncertainty against its native selector or compatibility descriptor,
alongside the existing raw-fact comparisons and unaffected-selection assertions.

Previous accepted format 2 SHA-256:
`25618166861fca22d4ced79efa6b40c38534fd6157f9bcc14ac1e25d4bee86ed`.
Corrected baseline SHA-256:
`6da89ab32e4c428f1f1c3dd15d0b1ecc1888def3affb70a6a969130678156c9c`.
The historical format 1 hash and input pins in the acceptance ledger are unchanged.
