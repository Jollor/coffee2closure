
/*
  @fileoverview Fix CoffeeScript compiled output for Google Closure Compiler.
  Code is beautified for easier debugging and compiled output reading.

  Issues
    CoffeeScript class declaration.
      unwrap for compiler be able to parse annotations
      change __extends to goog.inherits
      change __super__ to superClass_
      remove some mess
      ensure constructor is first after unwrap

    Remove and alias injected helpers.
      Closure Compiler needs bare code and injected methods are repeatedly
      declared in global space, which is wrong.
      __bind, __indexOf and __slice are replaced with Closure Array functions.

  Not Fixed (yet)
    Class metaprogramming possibilities, e.g. imperative code inside class
    declaration. It works, but variables are not scoped inside.
    Annotated splats.

  To Consider
    goog.scope, leverage it
 */
var _, addGeneratedBy, aliasRemovedInjectedCode, coffeeInjectedDeclarators, createSpace, esprima, findConstructors, fix, fixClasses, isCoffeeInjectedCode, isConstructor, iterator, mergeTokens, parse, prepareTokens, removeInjectedCode, removeLines, requireGoogArray, sortTokens, traverse, version,
  indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

esprima = require('esprima');

_ = require('underscore');

version = require('../package').version;

requireGoogArray = false;


/**
  @param {string} source
  @param {Object} options
    addGenerateByHeader: true
  @return {string}
 */

exports.fix = fix = function(source, options) {
  var constructors, isNodeJs, linesToRemove, syntax, tokens;
  requireGoogArray = false;
  syntax = parse(source);
  isNodeJs = syntax.tokens.some(function(item) {
    return item.type === 'Identifier' && item.value === 'exports';
  });
  if (isNodeJs) {
    return source;
  }
  tokens = prepareTokens(syntax, source);
  constructors = findConstructors(tokens);
  linesToRemove = {};
  removeInjectedCode(syntax, tokens, linesToRemove);
  fixClasses(constructors, tokens, linesToRemove);
  removeLines(tokens, linesToRemove);
  aliasRemovedInjectedCode(tokens);
  source = mergeTokens(tokens);
  if (requireGoogArray) {
    source = 'goog.require(\'goog.array\');\n' + source;
  }
  if (!options || options.addGenerateByHeader) {
    source = addGeneratedBy(source);
  }
  return source;
};


/**
  Traverse AST tree.
  @param {*}
  @param {Function} visitor Gets node. Return false to stop iteration.
  @return {boolan} false stops itesuper__
 */

exports.traverse = traverse = function(object, visitor) {
  var result;
  result = iterator(object, function(key, value) {
    var visitorResult;
    if (!value || typeof value !== 'object') {
      return;
    }
    if (value.type) {
      visitorResult = visitor(value);
      if (visitorResult === false) {
        return false;
      }
    }
    if (traverse(value, visitor) === false) {
      return false;
    }
  });
  if (result === false) {
    return false;
  }
};


/**
  @param {Object|Array} object
  @param {Function} callback
  @return {boolean} false if iteration has been stopped
 */

iterator = function(object, callback) {
  var i, item, k, key, len, value;
  if (Array.isArray(object)) {
    for (i = k = 0, len = object.length; k < len; i = ++k) {
      item = object[i];
      if (callback(i, item) === false) {
        return false;
      }
    }
  } else {
    for (key in object) {
      value = object[key];
      if (callback(key, value) === false) {
        return false;
      }
    }
  }
  return true;
};


/**
  @param {string} source
  @return {Object}
 */

parse = function(source) {
  return esprima.parse(source, {
    comment: true,
    tokens: true,
    range: true,
    loc: true
  });
};


/**
  @param {Object} syntax
  @param {string} source
  @return {Array.<Object>}
 */

prepareTokens = function(syntax, source) {
  var tokens;
  tokens = syntax.tokens.concat(syntax.comments);
  sortTokens(tokens);
  return tokens;
};


/**
  @param {Array.<Object>} tokens
  @return {Array}
 */

findConstructors = function(tokens) {
  var constructors, i, k, len, nextSibling, token;
  constructors = [];
  for (i = k = 0, len = tokens.length; k < len; i = ++k) {
    token = tokens[i];
    nextSibling = tokens[i + 1];
    if (!isConstructor(token, nextSibling)) {
      continue;
    }
    token.__className = nextSibling.value;
    constructors.push(token);
  }
  return constructors;
};


/**
  @param {Object} syntax
  @param {Array.<Object>} tokens
  @param {Object} linesToRemove
 */

removeInjectedCode = function(syntax, tokens, linesToRemove) {
  return traverse([syntax], function(node) {
    var comma, fstLineToks, i, k, ref, ref1, results, startLine, tokIsCoffeeInjected;
    if (isCoffeeInjectedCode(node)) {
      startLine = node.loc.start.line;
      fstLineToks = _.filter(tokens, function(tok) {
        return tok.loc.start.line === node.loc.start.line;
      });
      tokIsCoffeeInjected = function(tok) {
        var ref;
        return tok.type === 'Identifier' && (ref = tok.value, indexOf.call(coffeeInjectedDeclarators, ref) >= 0);
      };
      if (node.loc.end.line > startLine && !(_.any(fstLineToks, tokIsCoffeeInjected))) {
        comma = _.last(fstLineToks);
        console.assert(comma.value === ',');
        comma.value = ';';
        startLine = startLine + 1;
      }
      results = [];
      for (i = k = ref = startLine, ref1 = node.loc.end.line; ref <= ref1 ? k <= ref1 : k >= ref1; i = ref <= ref1 ? ++k : --k) {
        results.push(linesToRemove[i] = true);
      }
      return results;
    }
  });
};


/**
  @param {Array.<Object>} constructors
  @param {Array.<Object} tokens
  @param {Object} linesToRemove
 */

fixClasses = function(constructors, tokens, linesToRemove) {
  var _start, column, constructor, constructorHasComment, constructorIdx, constructorIsFirst, count, end, findTokInLine, firstTokenInWrapper, getToksForLine, i, j, k, l, len, line, maybeVar, namespace, nextToken, parentNamespace, previous, ref, ref1, ref2, removeTokens, start, tokIndex, token, tokensToMove, traverseLine, varRemoved;
  for (k = 0, len = constructors.length; k < len; k++) {
    constructor = constructors[k];
    column = constructor.loc.start.column;
    constructorIdx = tokens.indexOf(constructor);
    start = 0;
    end = 0;
    namespace = '';
    parentNamespace = '';
    i = constructorIdx;
    while (true) {
      token = tokens[++i];
      if (!token) {
        break;
      }
      if (token.loc.start.column === column - 2) {
        line = token.loc.start.line;
        linesToRemove[line - 2] = true;
        linesToRemove[line - 1] = true;
        linesToRemove[line] = true;
        end = i - 1;
        break;
      }
    }
    if (!token) {
      continue;
    }
    while (true) {
      token = tokens[i++];
      if (!token || token.loc.start.line !== line) {
        break;
      }
      if (token.type === 'Identifier' || token.type === 'Punctuator' && token.value === '.') {
        parentNamespace += token.value;
      }
    }
    i = constructorIdx;
    while (true) {
      token = tokens[--i];
      if (token.loc.start.column === column - 2) {
        j = i;
        while (true) {
          nextToken = tokens[j++];
          if (nextToken.type === 'Punctuator' && nextToken.value === '=') {
            break;
          }
          namespace += nextToken.value;
        }
        namespace = namespace.slice(0, -constructor.__className.length);
        linesToRemove[token.loc.start.line] = true;
        start = i + 1;
        break;
      }
    }
    traverseLine = function(start, callback) {
      var results;
      j = start;
      results = [];
      while (tokens[++j].loc.start.line === tokens[start].loc.start.line) {
        results.push(callback(tokens[j]));
      }
      return results;
    };
    getToksForLine = function(start) {
      var toks;
      toks = [];
      traverseLine(start, (function(tok) {
        return toks.push(tok);
      }));
      return toks;
    };
    findTokInLine = function(start, type, value) {
      var toks;
      toks = getToksForLine(start);
      return _.indexOf(_.map(toks, function(t) {
        return t.type + "-" + t.value;
      }), type + "-" + value);
    };
    removeTokens = function(start, count) {
      var _end, begin, last, ref, shiftBy;
      last = start + count - 1;
      ref = [tokens[start].range[0], tokens[last].range[1]], begin = ref[0], _end = ref[1];
      shiftBy = _end - begin;
      traverseLine(last, function(token) {
        token.range[0] -= shiftBy;
        token.range[1] -= shiftBy;
        token.loc.start.column -= shiftBy;
        return token.loc.end.column -= shiftBy;
      });
      return tokens.splice(start, count);
    };
    varRemoved = false;
    while (true) {
      token = tokens[--i];
      if (!token || token.loc.start.column < column - 2) {
        break;
      }
      if (token.type === 'Keyword' && token.value === 'var') {
        tokIndex = findTokInLine(i, 'Identifier', constructor.__className);
        if (tokIndex !== -1) {
          tokIndex += i + 1;
          console.assert(tokens[tokIndex + 1].type === 'Punctuator');
          if (tokIndex === i + 1 && tokens[tokIndex + 1].value === ';') {
            linesToRemove[token.loc.start.line] = true;
          } else {
            ref = tokens[tokIndex - 1].value === ',' ? [tokIndex - 1, 2] : [tokIndex, 2], _start = ref[0], count = ref[1];
            removeTokens(_start, count);
            constructorIdx -= count;
          }
          varRemoved = true;
          break;
        }
      }
    }
    maybeVar = "" + (varRemoved && namespace.length === 0 ? 'var ' : '');
    constructor.value = maybeVar + namespace + constructor.__className + ' =';
    tokens[constructorIdx + 1].value = 'function';
    line = tokens[start].loc.start.line;
    i = start;
    while (true) {
      token = tokens[i++];
      if (token.loc.start.line !== line) {
        break;
      }
    }
    firstTokenInWrapper = token;
    constructorHasComment = tokens[constructorIdx - 1].type === 'Block';
    constructorIsFirst = constructorHasComment ? tokens[constructorIdx - 1] === firstTokenInWrapper : firstTokenInWrapper === constructor;
    if (!constructorIsFirst) {
      tokensToMove = [constructor];
      i = constructorIdx;
      while (true) {
        token = tokens[++i];
        tokensToMove.push(token);
        if (token.loc.start.column === constructor.loc.start.column) {
          break;
        }
      }
      if (token.type !== 'Punctuator' && token.value !== '}') {
        tokensToMove.pop();
      }
      if (constructorHasComment) {
        tokensToMove.unshift(tokens[constructorIdx - 1]);
      }
      tokens.splice(tokens.indexOf(tokensToMove[0]), tokensToMove.length);
      tokens.splice.apply(tokens, [tokens.indexOf(firstTokenInWrapper), 0].concat(tokensToMove));
    }
    line = null;
    previous = null;
    for (i = l = ref1 = start, ref2 = end; ref1 <= ref2 ? l <= ref2 : l >= ref2; i = ref1 <= ref2 ? ++l : --l) {
      token = tokens[i];
      if (namespace && token.type === 'Identifier' && token.value === constructor.__className && !(previous.type === 'Punctuator' && previous.value === '.')) {
        token.value = namespace + token.value;
      }
      if (parentNamespace && token.type === 'Identifier' && token.value === '_super') {
        token.value = parentNamespace;
      }
      if (token.loc.start.line !== line) {
        token.loc.start.column = Math.max(0, token.loc.start.column - 2);
        line = token.loc.start.line;
      }
      if (token.type === 'Block') {
        token.value = token.value.replace(/\n  /g, '\n');
      }
      previous = token;
    }
  }
};


/**
  Is's easy to look for constructors, because the only function declaration
  in CoffeeScript transcompiled output is class constructor.
  http://stackoverflow.com/questions/6548750/function-declaration-in-coffeescript
  @param {Object} token
  @param {Object} nextSibling
  @return {boolean}
 */

isConstructor = function(token, nextSibling) {
  return token.type === 'Keyword' && token.value === 'function' && nextSibling && nextSibling.type === 'Identifier' && nextSibling.value !== 'ctor';
};


/**
  @param {Array.<Object>} tokens
 */

sortTokens = function(tokens) {
  return tokens.sort(function(a, b) {
    if (a.range[0] > b.range[0]) {
      return 1;
    } else if (a.range[0] < b.range[0]) {
      return -1;
    } else {
      return 0;
    }
  });
};


/**
  @param {Array.<Object>} tokens
  @param {Object.<string, boolean>} linesToRemove
 */

removeLines = function(tokens, linesToRemove) {
  var i, token;
  i = tokens.length;
  while (i--) {
    token = tokens[i];
    if (token.loc.start.line in linesToRemove) {
      tokens.splice(i, 1);
    }
  }
};


/**
  @param {Array.<Object>} tokens
 */

aliasRemovedInjectedCode = function(tokens) {
  var i, k, len, token;
  for (i = k = 0, len = tokens.length; k < len; i = ++k) {
    token = tokens[i];
    if (token.type !== 'Identifier') {
      continue;
    }
    switch (token.value) {
      case '__bind':
        token.type = 'fixed_Identifier';
        token.value = 'goog.bind';
        break;
      case '__indexOf':
        token.type = 'fixed_Identifier';
        token.value = 'goog.array.indexOf';
        tokens[i + 1].value = '';
        tokens[i + 2].value = '';
        requireGoogArray = true;
        break;
      case '__slice':
        token.type = 'fixed_Identifier';
        token.value = 'goog.array.slice';
        tokens[i + 1].value = '';
        tokens[i + 2].value = '';
        requireGoogArray = true;
        break;
      case '__super__':
        token.type = 'fixed_Identifier';
        token.value = 'superClass_';
        break;
      case '__extends':
        token.type = 'fixed_Identifier';
        token.value = 'goog.inherits';
    }
  }
};


/**
  @param {Array.<Object>} tokens
  @return {string}
 */

mergeTokens = function(tokens) {
  var k, len, newLine, previous, source, token;
  source = '';
  for (k = 0, len = tokens.length; k < len; k++) {
    token = tokens[k];
    newLine = false;
    if (previous) {
      newLine = token.loc.start.line !== previous.loc.end.line;
      if (newLine) {
        source += createSpace(token.loc.start.column, true);
      } else {
        source += createSpace(token.loc.start.column - previous.loc.end.column);
      }
    }
    if (token.type === 'Block') {
      if (newLine) {
        source += "\n/*" + token.value + "*/";
      } else {
        source += "/*" + token.value + "*/";
      }
    } else if (token.type === 'Line') {
      source += "//" + token.value;
    } else {
      source += token.value;
    }
    previous = token;
  }
  return source;
};


/**
 @param {number} length The number of times to repeat.
 @param {boolean} newLine
 @return {string}
 */

createSpace = function(length, newLine) {
  var space;
  if (length < 0) {
    return '';
  }
  space = new Array(length + 1).join(' ');
  if (newLine) {
    space = '\n' + space;
  }
  return space;
};


/**
  @param {string} source
  @return {string}
 */

addGeneratedBy = function(source) {
  return ("// Generated by github.com/steida/coffee2closure " + version + "\n") + source;
};

coffeeInjectedDeclarators = ['__hasProp', '__extends', '__slice', '__bind', '__indexOf'];


/**
  @param {Object} node
  @return {boolean}
 */

isCoffeeInjectedCode = function(node) {
  return node.type === 'VariableDeclaration' && node.declarations.some(function(declaration) {
    var ref;
    return declaration.type === 'VariableDeclarator' && (ref = declaration.id.name, indexOf.call(coffeeInjectedDeclarators, ref) >= 0);
  });
};
