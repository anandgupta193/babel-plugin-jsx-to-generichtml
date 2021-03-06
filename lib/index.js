'use strict';

var generator = require("babel-generator").default;

Object.defineProperty(exports, "__esModule", {
    value: true
});

exports.default = function (babel) {
    var t = babel.types;

    function parseAsString(expression) {
        var ast = {
            type: 'Program',
            body: [t.expressionStatement(expression)]
        };
        var code = babel.transformFromAst(ast).code;
        if (code.endsWith(';')) {
            code = code.slice(0, code.length - 1);
        }
        return code;
    }

    function createPseudoElement(dataAttr, typeAttr, bodyArr, tagName) {
        var ifNode = t.jSXIdentifier(tagName);
        var attrArr = [];
        var pseudoDataAttr = null;
        if (dataAttr) {
            pseudoDataAttr = t.jSXAttribute(t.jSXIdentifier('data'), t.stringLiteral(dataAttr));
            attrArr.push(pseudoDataAttr);
        }
        var pseudoTypeAttr = null;
        if (typeAttr) {
            pseudoTypeAttr = t.jSXAttribute(t.jSXIdentifier('type'), t.stringLiteral(typeAttr));
            attrArr.push(pseudoTypeAttr);
        }
        var pseudoOpen = t.jSXOpeningElement(ifNode, attrArr, false);
        var pseudoClose = t.jSXClosingElement(t.jSXIdentifier(tagName));
        var pseudoElem = t.jSXElement(pseudoOpen, pseudoClose, bodyArr);
        pseudoElem.selfClosing = false;
        return pseudoElem;
    }

    function processLogicalExp(path, lazyTags) {
        var exp = path.node.expression;
        var body = exp.right;
        //unsupported currently
        if (!t.isJSXElement(body)) {
            return false;
        } else {
            //check if skip required inside expression: possible usecase for dynamic element
            var tag = body.openingElement.name.name;
            if (lazyTags.indexOf(tag) != -1) {
                path.remove();
                return false;
            }
        }
        var logicType = exp.operator;
        var logic = exp.left;
        var stringexp = parseAsString(exp.left);
        /**
         * Creating pseudo html element and replacing with logical expression.
         */
        path.replaceWith(createPseudoElement(stringexp, logicType, [body], 'PLUGIN-CONDITION'));
    }

    function processCallExp(path, state) {
        var exp = path.node.expression;

        /**
         * 
         * Processing call expression (method calls)
         * Separately processing map method.
         * 
         */

        if (t.isCallExpression(exp) && exp.callee.property.name == 'map') {
            var object = exp.callee.object;
            var propPath = [];
            var type = null;
            var bodyElem = null;
            while (t.isMemberExpression(object)) {
                propPath.unshift(object.property.name);
                object = object.object;
            }
            //object should be an identifier if not a member exp
            propPath.unshift(object.name);
            if (Array.isArray(exp.arguments) && Array.isArray(exp.arguments[0].params)) {
                type = exp.arguments[0].params[0].name;
            }
            if (Array.isArray(exp.arguments) && exp.arguments[0].body && Array.isArray(exp.arguments[0].body.body)) {
                var element = exp.arguments[0].body.body[0];
                if (element.argument) {
                    bodyElem = element.argument;
                } else if (element.type = "IfStatement") {
                    bodyElem = createPseudoElement(parseAsString(element.test), element.test.operator, [element.consequent.body[0].argument], 'PLUGIN-CONDITION');
                }
            }
            var prop = propPath.join('.');

            var bodyArray = [];
            if (bodyElem) {
                bodyArray.push(bodyElem);
            }
            // create pseudo element
            var pseudoEle = createPseudoElement(prop, type, bodyArray, 'PLUGIN-LOOP');
            path.replaceWith(pseudoEle);
        } else if (t.isCallExpression(exp) && state.classMethods.hasOwnProperty(exp.callee.property.name)) {
            state.exp.splice(state.exp.indexOf(exp), 1);
            const renderElem = genericTraverse(state.classMethods[exp.callee.property.name], state);
            if (path && path.node && path.node.expression && path.node.expression.callee) {
                /**
                 * If needed, Attributes can be added for function reference.
                 */
                // renderElem.openingElement.attributes.push(t.jSXAttribute(t.jSXIdentifier('func-ref'), t.stringLiteral(path.node.expression.callee.property.name)));

                /**
                 * Recursively replacing function call with JSX. 
                 */
                path.replaceWith(renderElem);
            }
        }
    }

    /**
     *
     * Implemented Generic Traverse method for traversing tree recursively
     * 
     * @param {*} path
     * @param {*} state
     * 
     */
    function genericTraverse(path, state) {

        var returnNode = path.node.body.body.filter(function (obj) {
            return t.isReturnStatement(obj);
        });
        var renderReturn = returnNode[0].argument;

        /**
         * Traversing AST and transforming expressions and custom components.
         */
        path.traverse({
            JSXExpressionContainer: function JSXExpressionContainer(path) {
                state.exp.unshift(path);
            },
            JSXOpeningElement: function JSXOpeningElement(path) {
                var tag = path.node.name.name;
                if (state.importProps.hasOwnProperty(tag)) {
                    path.node.attributes.push(t.jSXAttribute(t.jSXIdentifier('cust-loc'), t.stringLiteral(state.importProps[tag])));
                }
            }
        });
        path.stop();

        state.exp.map(function (path) {
            if (t.isLogicalExpression(path.node.expression)) {
                processLogicalExp(path, state.opts.lazyTags);
            } else if (t.isCallExpression(path.node.expression)) {
                processCallExp(path, state);
            }
        });

        return renderReturn;
    }


    return {
        visitor: {
            Program: function Program(path, state) {
                //init state variables
                state.importProps = {};
                state.classMethods = {};
                state.opts.lazyTags = state.opts.lazyTags || [];
                Object.assign(state, {
                    importProps: {},
                    exp: [],
                    mainPlace: path,
                    classMethods: {}
                });
            },
            ImportDeclaration: function ImportDeclaration(path, _ref) {
                var importProps = _ref.importProps;
                var specifiers = path.node.specifiers;
                var loc = path.node.source.value;
                var _iteratorNormalCompletion = true;
                var _didIteratorError = false;
                var _iteratorError = undefined;

                try {
                    for (var _iterator = specifiers[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                        var obj = _step.value;

                        importProps[obj.local.name] = loc;
                    }
                } catch (err) {
                    _didIteratorError = true;
                    _iteratorError = err;
                } finally {
                    try {
                        if (!_iteratorNormalCompletion && _iterator.return) {
                            _iterator.return();
                        }
                    } finally {
                        if (_didIteratorError) {
                            throw _iteratorError;
                        }
                    }
                }
                // path.remove();
            },
            Class: function (path, state) {
                path.traverse({
                    ClassMethod: function ClassMethod(path) {
                        state.classMethods[path.node.key.name] = path;
                    }
                });

                Object.keys(state.classMethods).forEach(element => {
                    if (element === 'render') {
                        const renderReturn = genericTraverse(state.classMethods[element], state);
                        state.mainPlace.replaceWith(t.Program([t.expressionStatement(renderReturn)]));
                    }
                });
            },
            VariableDeclaration: function (path, state) {
                if (path.node.declarations[0].id.name === 'style') {
                    var ast = {
                        type: 'Program',
                        body: [path.node]
                    };
                    var styleString = generator(ast, {}, "").code;
                    var styleObj = JSON.parse(styleString.substring(styleString.indexOf("{"), styleString.indexOf("}") + 1));
                    state.style = styleObj;
                }
            },
            JSXIdentifier: function (path) {
                if (path.node.name === 'className') {
                    path.node.name = 'class';
                }
            },
            JSXExpressionContainer: function (path, state) {
                if (path.node.expression.type === 'TemplateLiteral') {
                    var stringLiteral = '';
                    path.node.expression.expressions.forEach(element => {
                        if (element.type === 'MemberExpression') {
                            if (element.object.name === 'style') {
                                stringLiteral += ' ' + state.style[element.property.value];
                            }
                        }
                    });
                    path.node.expression.quasis.forEach(element => {
                        stringLiteral += element.value.cooked;
                    });

                    path.replaceWith(t.stringLiteral(stringLiteral));
                }

            }
        }
    };
};