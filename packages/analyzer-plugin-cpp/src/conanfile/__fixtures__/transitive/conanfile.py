from conan import ConanFile

class TransitiveApp(ConanFile):
    name = "transitiveapp"
    version = "1.0"
    settings = "os", "compiler", "build_type", "arch"

    def requirements(self):
        self.requires("spdlog/1.17.0")
        self.requires("drogon/1.9.12")
        self.requires("libsoup/3.6.6")

    def build_requirements(self):
        self.tool_requires("cmake/3.27.7")

    def test(self):
        pass
