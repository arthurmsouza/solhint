const Reporter = require('./../reporter');
const TreeTraversing = require('./../common/tree-traversing');
const naming = require('./../common/identifier-naming');


const SEVERITY = Reporter.SEVERITY;
const traversing = new TreeTraversing();

class VarNameStyleChecker {

    constructor(reporter) {
        this.reporter = reporter;
    }

    exitIdentifierList(ctx) {
        this.validateVariablesName(ctx);
    }

    exitVariableDeclaration(ctx) {
        this.validateVariablesName(ctx);
    }

    exitStateVariableDeclaration(ctx) {
        const hasConstModifier = ctx.children.some(i => i.getText() == 'constant');

        if (!hasConstModifier) {
            this.validateVariablesName(ctx);
        }
    }

    validateVariablesName(ctx) {
        for (let curId of traversing.findIdentifier(ctx)) {
            const text = curId.getText();

            if (naming.isNotMixedCase(text)) {
                this.reporter.addMessage(
                    curId.getSourceInterval(), SEVERITY.ERROR,
                    'Variable name must be in mixedCase', 'var-name-mixedcase'
                );
            }
        }
    }

}


module.exports = VarNameStyleChecker;