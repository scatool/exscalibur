#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib

from packaging.requirements import InvalidRequirement, Requirement
from packaging.utils import InvalidName, canonicalize_name


FIXTURES_DIR = Path(__file__).resolve().parents[1] / "src" / "pyprojecttoml" / "__fixtures__"


def main() -> int:
    failures: list[str] = []

    for path in sorted(FIXTURES_DIR.glob("*/pyproject.toml")):
        try:
            data = tomllib.loads(path.read_text())
        except tomllib.TOMLDecodeError as error:
            failures.append(f"{path}: invalid TOML: {error}")
            continue

        validate_pep508_dependencies(path, data, failures)
        validate_poetry_dependency_keys(path, data, failures)

    for failure in failures:
        print(failure)

    return 1 if failures else 0


def validate_pep508_dependencies(path: Path, data: dict, failures: list[str]) -> None:
    project = data.get("project", {})

    for dependency in as_string_list(project.get("dependencies")):
        validate_requirement(path, "project.dependencies", dependency, failures)

    for extra, dependencies in project.get("optional-dependencies", {}).items():
        for dependency in as_string_list(dependencies):
            validate_requirement(path, f"project.optional-dependencies.{extra}", dependency, failures)

    tool = data.get("tool", {})
    uv = tool.get("uv", {})
    for dependency in as_string_list(uv.get("dev-dependencies")):
        validate_requirement(path, "tool.uv.dev-dependencies", dependency, failures)

    pdm = tool.get("pdm", {})
    for group, dependencies in pdm.get("dev-dependencies", {}).items():
        for dependency in as_string_list(dependencies):
            validate_requirement(path, f"tool.pdm.dev-dependencies.{group}", dependency, failures)

    for group, dependencies in data.get("dependency-groups", {}).items():
        for dependency in as_string_list(dependencies):
            validate_requirement(path, f"dependency-groups.{group}", dependency, failures)


def validate_poetry_dependency_keys(path: Path, data: dict, failures: list[str]) -> None:
    poetry = data.get("tool", {}).get("poetry", {})

    validate_poetry_table(path, "tool.poetry.dependencies", poetry.get("dependencies", {}), failures)
    validate_poetry_table(
        path,
        "tool.poetry.dev-dependencies",
        poetry.get("dev-dependencies", {}),
        failures,
    )

    for group, group_data in poetry.get("group", {}).items():
        validate_poetry_table(
            path,
            f"tool.poetry.group.{group}.dependencies",
            group_data.get("dependencies", {}),
            failures,
        )


def validate_poetry_table(
    path: Path,
    section: str,
    dependencies: dict,
    failures: list[str],
) -> None:
    for name in dependencies:
        if name.lower() == "python":
            continue
        try:
            canonicalize_name(name, validate=True)
        except InvalidName as error:
            failures.append(f"{path}: invalid dependency name in {section}: {name!r}: {error}")


def validate_requirement(path: Path, section: str, dependency: str, failures: list[str]) -> None:
    try:
        Requirement(dependency)
    except InvalidRequirement as error:
        failures.append(f"{path}: invalid PEP 508 dependency in {section}: {dependency!r}: {error}")


def as_string_list(value: object) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        return []
    return [entry for entry in value if isinstance(entry, str)]


if __name__ == "__main__":
    raise SystemExit(main())
