const _ = require('lodash');
const { columnOf, lineOf, stopLine } = require('./../../common/tokens');


class IndentChecker {

    constructor(reporter, config) {
        this.reporter = reporter;
        this.linesWithError = [];

        const indent = this.parseConfig(config).indent || 4;
        const indentUnit = this.parseConfig(config).unit || 'spaces';

        this.blockValidator = new BlockValidator(indent, indentUnit, reporter);
        this.nestedSingleLineValidator = new NestedSingleLineValidator(indent, indentUnit, reporter);
        this.baseIndentMultiplicityValidator = new BaseIndentMultiplicityValidator(indent, reporter);
    }

    enterBlock (ctx) {
        this.blockValidator.validateBlock(ctx);
    }

    enterContractDefinition (ctx) {
        this.blockValidator.validateBlock(ctx);
    }

    enterStructDefinition (ctx) {
        this.blockValidator.validateBlock(ctx);
    }

    enterEnumDefinition (ctx) {
        this.blockValidator.validateBlock(ctx);
    }

    enterImportDirective(ctx) {
        this.blockValidator.validateBlock(ctx);
    }

    enterFunctionCallArguments(ctx) {
        this.blockValidator.validateBlock(ctx);
    }

    enterIfStatement (ctx) {
        const THEN_STATEMENT_POSITION = 4;
        const ELSE_STATEMENT_POSITION = 6;
        const STATEMENTS_POSITION = [THEN_STATEMENT_POSITION, ELSE_STATEMENT_POSITION];

        this.nestedSingleLineValidator.validateMultiple(ctx, STATEMENTS_POSITION);
    }

    enterWhileStatement (ctx) {
        const STATEMENT_POSITION = 4;

        this.nestedSingleLineValidator.validate(ctx, STATEMENT_POSITION);
    }

    enterDoWhileStatement (ctx) {
        this.nestedSingleLineValidator.validate(ctx, 1);
    }

    enterForStatement (ctx) {
        this.nestedSingleLineValidator.validate(ctx, ctx.children.length - 1);
    }

    enterSourceUnit(ctx) {
        ctx
            .children
            .filter(i => i.getText() !== '<EOF>')
            .forEach(curNode =>
                this.blockValidator.validateNode(0)(curNode, lineOf(curNode), columnOf(curNode))
            );
    }

    exitSourceUnit(ctx) {
        const linesWithErrors = this.getLinesWithError();

        this.baseIndentMultiplicityValidator.validate(linesWithErrors, ctx);
    }

    parseConfig(config) {
        const rules = config.rules;
        if (!(rules && rules.indent && rules.indent.length === 2)) {
            return {};
        }

        const indentConf = rules.indent[1];
        if (indentConf === 'tabs') {
            return { indent: 1, unit: 'tabs' };
        } else if (_.isNumber(indentConf)) {
            return { indent: indentConf, unit: 'spaces' };
        } else {
            return {};
        }
    }

    getLinesWithError () {
        return [].concat(
            this.nestedSingleLineValidator.linesWithError,
            this.blockValidator.linesWithError
        );
    }

}


class Block {

    constructor (ctx) {
        this.ctx = ctx;
        this.startBracketIndex = _.memoize(this._startBracketIndex.bind(this));
        this.endBracketIndex = _.memoize(this._endBracketIndex.bind(this));
    }

    _startBracketIndex () {
        const children = this.ctx.children;
        return children && children.map(i => i.getText()).indexOf('{');
    }

    hasStartBracket () {
        return this.startBracketIndex() !== null && this.startBracketIndex() >= 0;
    }

    startBracket () {
        return this.ctx.children[this.startBracketIndex()];
    }

    startBracketLine () {
        return this.startBracket().symbol.line;
    }

    _endBracketIndex () {
        return this.ctx.children.map(i => i.getText()).indexOf('}');
    }

    endBracket () {
        const children = this.ctx.children;
        return children[children.length - 1];
    }

    endBracketLine () {
        return this.endBracket().symbol.line;
    }

    endBracketColumn () {
        return this.endBracket().symbol.column;
    }

    isBracketsOnSameLine () {
        return this.startBracketLine() === this.endBracketLine();
    }

    forEachNestedNode (callback) {
        for (let i = this.startBracketIndex() + 1; i < this.endBracketIndex(); i += 1) {
            const curItem = this.ctx.children[i];
            const isTerm = curItem.symbol;

            !isTerm && callback && callback(curItem, lineOf(curItem), columnOf(curItem));
        }
    }

}


class KnowLineValidator {

    constructor (indent, indentUnit, reporter) {
        this.indent = indent;
        this.indentUnit = indentUnit;
        this.reporter = reporter;
        this.linesWithError = [];
    }

    makeReportCorrectLine(line, col, correctIndent) {
        this.linesWithError.push(line);

        const message = `Expected indentation of ${correctIndent} ${this.indentUnit} but found ${col}`;
        this.reporter.errorAt(line, col, 'indent', message);
    }

}


class BlockValidator extends KnowLineValidator {

    constructor (indent, indentUnit, reporter) {
        super(indent, indentUnit, reporter);
    }

    validateBlock(ctx) {
        const block = new Block(ctx);

        if (!block.hasStartBracket() || block.isBracketsOnSameLine()) {
            return;
        }

        this.validateIndentOfNestedElements(block);

        this.validateEndBracketIndent(block);
    }

    validateIndentOfNestedElements(block) {
        const requiredIndent = correctIndentOf(firstNodeOfLine(block.ctx)) + this.indent;

        block.forEachNestedNode(this.validateNode(requiredIndent));
    }

    validateNode(requiredIndent) {
        return (curItem, curLine, curColumn) => {
            if (curColumn !== requiredIndent) {
                this.makeReportCorrectLine(curLine, curColumn, requiredIndent);
                curItem.indentError = {indent: curColumn, correctIndent: requiredIndent};
            }
        };
    }

    validateEndBracketIndent(block) {
        const endBracketCorrectIndent = correctIndentOf(firstNodeOfLine(block.ctx));

        if (endBracketCorrectIndent !== block.endBracketColumn()) {
            this.makeReportCorrectLine(block.endBracketLine(), block.endBracketColumn(), endBracketCorrectIndent);
        }
    }

}


class NestedSingleLineValidator extends KnowLineValidator {

    constructor (indent, indentUnit, reporter) {
        super(indent, indentUnit, reporter);
    }

    validateMultiple (ctx, indexes) {
        indexes.forEach(index =>
            this.validate(ctx, index)
        );
    }

    validate (ctx, index) {
        if (ctx.children.length <= index) {
            return;
        }

        const statement = ctx.children[index];
        const statementColumn = columnOf(statement);
        const statementLine = lineOf(statement);
        const start = ctx.start;
        const requiredIndent = correctIndentOf(ctx.parentCtx) + this.indent;

        if (!['BlockContext', 'IfStatementContext'].includes(statement.children[0].constructor.name)
            && statementColumn !== requiredIndent && statementLine !== start.line) {
            this.makeReportCorrectLine(statementLine, statementColumn, requiredIndent);
            statement.indentError = {
                indent: statementColumn,
                correctIndent: correctIndentOf(ctx.parentCtx) + this.indent
            };
        }
    }

}


class BaseIndentMultiplicityValidator {

    constructor (indent, reporter) {
        this.reporter = reporter;
        this.indent = indent;
        this.firstIndent = new Map();
    }

    validate (linesWithError, ctx) {
        const tokens = ctx.parser._input.tokens.filter(i => i.channel === 0 && i.type >= 0);

        tokens.forEach(this.applyTokenIndent.bind(this));

        for (let curLineStr in this.firstIndent) {
            const curLine = Number(curLineStr);
            if (linesWithError.includes(Number(curLine))) {
                continue;
            }

            const curIndent = this.firstIndent[curLine];
            if (this.isNotValidForBaseIndent(curIndent)) {
                this.error(curLine, curIndent);
            }
        }
    }

    applyTokenIndent(token) {
        const line = token.line;
        const column = token.column;
        const curIndent = this.firstIndent[line];

        if (curIndent > column || _.isUndefined(curIndent)) {
            this.firstIndent[line] = column;
        }
    }

    isNotValidForBaseIndent(indent) {
        return indent % this.indent !== 0;
    }

    error(line, col) {
        this.reporter.errorAt(line, col, 'indent', 'Indentation is incorrect');
    }

}


function correctIndentOf(ctx) {
    let curIndent = columnOf(ctx);
    let curCtx = ctx;

    do {
        if (curCtx.indentError) {
            curIndent = correctIndent(curIndent, curCtx.indentError);
            return curIndent;
        }

        curCtx = curCtx.parentCtx;
    } while (curCtx !== null && lineOf(ctx) === lineOf(curCtx));

    return curIndent;
}


function correctIndent(curIndent, indentError) {
    return curIndent - indentError.indent + indentError.correctIndent;
}


function firstNodeOfLine (ctx) {
    let rootCtx = ctx;

    while (rootCtx.parentCtx && rootCtx.start.line === rootCtx.parentCtx.start.line &&
            !['SourceUnitContext'].includes(rootCtx.parentCtx.constructor.name)) {
        rootCtx = rootCtx.parentCtx;
    }

    let resultNode = rootCtx;

    if (rootCtx.parentCtx !== null) {
        const curParent = rootCtx.parentCtx;
        const rootIdx = curParent.children.indexOf(rootCtx);

        for (let i = rootIdx - 1; i >= 0; i -= 1) {
            const curChild = curParent.children[i];

            if (stopLine(curChild) === lineOf(rootCtx)) {
                resultNode = curChild;
            }
        }
    }

    if (lineOf(ctx) !== lineOf(resultNode)) {
        return firstNodeOfLine(resultNode);
    }

    return resultNode;
}


module.exports = IndentChecker;