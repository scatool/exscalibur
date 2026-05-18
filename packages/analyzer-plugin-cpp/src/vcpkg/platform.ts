import type { VcpkgTargetPlatform } from './options';

/**
 * Parses and evaluates a platform expression against a given target platform as specified in
 * https://learn.microsoft.com/en-us/vcpkg/reference/vcpkg-json#platform-expression
 *
 * @param platformExpression the platform expression to evaluate
 * @param targetPlatform the target platform to evaluate against
 * @return true if the platform expression matches the target platform, false otherwise
 */
export function matchesPlatform(platformExpression: string, targetPlatform: VcpkgTargetPlatform): boolean {
  try {
    const parser = createParser(platformExpression, targetPlatform);
    const result = parser.parseExpression();
    parser.ensureAtEnd();
    return result;
  } catch {
    return false;
  }
}
function isIdentifierChar(char: string): boolean {
  return /[a-zA-Z0-9_]/.test(char);
}

class ParseError extends Error {
  readonly index: number;

  constructor(message: string, index: number) {
    super(message);
    this.index = index;
  }
}

function createParser(expression: string, targetPlatform: VcpkgTargetPlatform) {
  let index = 0;

  function parseExpression(): boolean {
    return parseOr();
  }

  function parseOr(): boolean {
    let value = parseAnd();
    while (true) {
      skipWhitespace();
      if (matchChar('|') || matchChar(',')) {
        const rhs = parseAnd();
        value = value || rhs;
        continue;
      }
      if (peekIdentifier() === 'or') {
        throw error("Reserved keyword 'or' is not a valid operator");
      }
      break;
    }
    return value;
  }

  function parseAnd(): boolean {
    let value = parseUnary();
    while (true) {
      skipWhitespace();
      if (matchChar('&')) {
        const rhs = parseUnary();
        value = value && rhs;
        continue;
      }
      if (matchKeyword('and')) {
        const rhs = parseUnary();
        value = value && rhs;
        continue;
      }
      break;
    }
    return value;
  }

  function parseUnary(): boolean {
    skipWhitespace();
    if (matchChar('!') || matchKeyword('not')) {
      return !parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): boolean {
    skipWhitespace();
    if (matchChar('(')) {
      const value = parseExpression();
      skipWhitespace();
      if (!matchChar(')')) {
        throw error('Expected )');
      }
      return value;
    }

    if (isAtEnd()) {
      throw error('Unexpected end of expression');
    }

    if (isIdentifierChar(expression[index] || '')) {
      const identifier = consumeIdentifier();
      if (identifier === 'or') {
        throw error("Reserved keyword 'or' is not a valid operator");
      }
      if (identifier === 'and' || identifier === 'not') {
        throw error(`Unexpected keyword '${identifier}'`);
      }
      return evaluateIdentifier(identifier, targetPlatform);
    }

    throw error(`Unexpected token '${expression[index]}'`);
  }

  function matchChar(char: string): boolean {
    skipWhitespace();
    if (expression[index] === char) {
      index += 1;
      return true;
    }
    return false;
  }

  function matchKeyword(keyword: string): boolean {
    skipWhitespace();
    if (peekIdentifier() !== keyword) {
      return false;
    }
    consumeIdentifier();
    return true;
  }

  function peekIdentifier(): string | null {
    skipWhitespace();
    if (isAtEnd() || !isIdentifierChar(expression[index] || '')) {
      return null;
    }
    let cursor = index;
    while (cursor < expression.length && isIdentifierChar(expression[cursor] || '')) {
      cursor += 1;
    }
    return expression.slice(index, cursor).toLowerCase();
  }

  function consumeIdentifier(): string {
    skipWhitespace();
    if (isAtEnd() || !isIdentifierChar(expression[index] || '')) {
      throw error('Expected identifier');
    }
    const start = index;
    while (index < expression.length && isIdentifierChar(expression[index] || '')) {
      index += 1;
    }
    return expression.slice(start, index).toLowerCase();
  }

  function skipWhitespace(): void {
    while (index < expression.length) {
      const char = expression[index];
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        index += 1;
      } else {
        break;
      }
    }
  }

  function isAtEnd(): boolean {
    return index >= expression.length;
  }

  function error(message: string): ParseError {
    return new ParseError(message, index);
  }

  function ensureAtEnd(): void {
    skipWhitespace();
    if (!isAtEnd()) {
      throw error(`Unexpected token '${expression[index]}'`);
    }
  }

  return {
    parseExpression,
    ensureAtEnd,
  };
}

function evaluateIdentifier(identifier: string, targetPlatform: VcpkgTargetPlatform): boolean {
  const architecture = targetPlatform.targetArchitecture;
  const cmakeSystemName = targetPlatform.cmakeSystemName;

  switch (identifier) {
    case 'x64':
    case 'x86':
    case 'arm64':
    case 'arm64ec':
    case 'wasm32':
    case 'mips64':
      return architecture === identifier;
    case 'arm':
      return architecture === 'arm' || architecture === 'arm64';
    case 'arm32':
      return architecture === 'arm';
    case 'windows':
      return cmakeSystemName === '' || cmakeSystemName === 'WindowsStore' || cmakeSystemName === 'MinGW';
    case 'mingw':
      return cmakeSystemName === 'MinGW';
    case 'uwp':
      return cmakeSystemName === 'WindowsStore';
    case 'xbox':
      return cmakeSystemName === '' && Boolean(targetPlatform.xboxConsoleTarget);
    case 'linux':
      return cmakeSystemName === 'Linux';
    case 'osx':
      return cmakeSystemName === 'Darwin';
    case 'ios':
      return cmakeSystemName === 'iOS';
    case 'freebsd':
      return cmakeSystemName === 'FreeBSD';
    case 'openbsd':
      return cmakeSystemName === 'OpenBSD';
    case 'android':
      return cmakeSystemName === 'Android';
    case 'emscripten':
      return cmakeSystemName === 'Emscripten';
    case 'qnx':
      return cmakeSystemName === 'QNX';
    case 'vxworks':
      return cmakeSystemName === 'VxWorks';
    case 'static':
      return targetPlatform.libraryLinkage === 'static';
    case 'staticcrt':
      return targetPlatform.crtLinkage === 'static';
    case 'native':
      return targetPlatform.isNative === true;
    default:
      return false;
  }
}
