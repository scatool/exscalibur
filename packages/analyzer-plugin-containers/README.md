# @scatool/analyzer-plugin-containers

**Note**: This plugin is experimental.

## Native result V2

`dockerfileExtractor` and `extractDockerfile` preserve `FROM` inputs as source
**declarations**, not resolved image dependencies. Each Dockerfile owns a `from`
root. External references retain their original spelling, including variables;
observed ARG defaults and platform selectors are metadata, not proof of selected
build inputs. Internal stages and `scratch` do not introduce external requests.
Unsupported `FROM` syntax produces partial adjacency and an issue. Image contents,
selected build targets and transitive dependencies remain unobserved.

The default API returns format 2. The `V2` export names remain aliases of the same
implementation; no legacy result implementation is retained.
