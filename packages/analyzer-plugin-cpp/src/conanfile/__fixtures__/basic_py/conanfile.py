from conan import ConanFile

class ComplexApp(ConanFile):
    name = "myapp"
    version = "1.0"
    settings = "os", "compiler", "build_type", "arch"

    def requirements(self):
        self.requires("fmt/7.1.3")
        self.requires("zlib/1.3.1")

    def build_requirements(self):
        self.tool_requires("cmake/3.27.7")

    def test(self):
        pass
