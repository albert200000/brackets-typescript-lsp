/* eslint-disable indent */
/* eslint max-len: ["error", { "code": 200 }]*/
define(function (require, exports, module) {
    "use strict";

    var _ = brackets.getModule("thirdparty/lodash");

    var DefaultProviders = brackets.getModule("languageTools/DefaultProviders"),
        EditorManager = brackets.getModule('editor/EditorManager'),
        TokenUtils = brackets.getModule("utils/TokenUtils"),
        StringMatch = brackets.getModule("utils/StringMatch"),
        matcher = new StringMatch.StringMatcher({
            preferPrefixMatches: true
        });

    var hintType = {
        "2": "Method",
        "3": "Function",
        "4": "Constructor",
        "6": "Variable",
        "7": "Class",
        "8": "Interface",
        "9": "Module",
        "10": "Property",
        "14": "Keyword",
        "21": "Constant"
    };

    function CodeHintsProvider(client) {
        this.defaultCodeHintProviders = new DefaultProviders.CodeHintsProvider(client);
    }

    CodeHintsProvider.prototype.setClient = function (client) {
        this.defaultCodeHintProviders.setClient(client);
    };

    function setStyleAndCacheToken($hintObj, token) {
        $hintObj.addClass('brackets-hints-with-type-details');
        $hintObj.data('completionItem', token);
    }

    function filterWithQueryAndMatcher(hints, query) {
        var matchResults = $.map(hints, function (hint) {
            var searchResult = matcher.match(hint.label, query);
            if (searchResult) {
                for (var key in hint) {
                    searchResult[key] = hint[key];
                }
            }

            return searchResult;
        });

        return matchResults;
    }

    CodeHintsProvider.prototype.hasHints = function (editor, implicitChar) {
        return this.defaultCodeHintProviders.hasHints(editor, implicitChar);
    };

    CodeHintsProvider.prototype.getHints = function (implicitChar) {
        if (!this.defaultCodeHintProviders.client) {
            return null;
        }

        var editor = EditorManager.getActiveEditor(),
            pos = editor.getCursorPos(),
            docPath = editor.document.file._path,
            $deferredHints = $.Deferred(),
            self = this.defaultCodeHintProviders,
            client = this.defaultCodeHintProviders.client;

        //Make sure the document is in sync with the server
        client.notifyTextDocumentChanged({
            filePath: docPath,
            fileContent: editor.document.getText()
        });
        client.requestHints({
            filePath: docPath,
            cursorPos: pos
        }).done(function (msgObj) {
            var context = TokenUtils.getInitialContext(editor._codeMirror, pos),
                hints = [];

            self.query = context.token.string.slice(0, context.pos.ch - context.token.start);
            if (msgObj) {
                var res = msgObj.items || [],
                    trimmedQuery = self.query.trim(),
                    hasIgnoreCharacters = self.ignoreQuery.includes(implicitChar) || self.ignoreQuery.includes(trimmedQuery),
                    isExplicitInvokation = implicitChar === null;

                var filteredHints = [];
                if (hasIgnoreCharacters || (isExplicitInvokation && !trimmedQuery)) {
                    filteredHints = filterWithQueryAndMatcher(res, "");
                } else {
                    filteredHints = filterWithQueryAndMatcher(res, self.query);
                }

                StringMatch.basicMatchSort(filteredHints);
                filteredHints.forEach(function (element) {
                    var $fHint = $("<span>")
                        .addClass("brackets-hints");

                    if (element.stringRanges) {
                        element.stringRanges.forEach(function (item) {
                            if (item.matched) {
                                $fHint.append($("<span>")
                                    .append(_.escape(item.text))
                                    .addClass("matched-hint"));
                            } else {
                                $fHint.append(_.escape(item.text));
                            }
                        });
                    } else {
                        $fHint.text(element.label);
                    }

                    $fHint.data("token", element);
                    setStyleAndCacheToken($fHint, element);
                    hints.push($fHint);
                });
            }

            var token = self.query;
            $deferredHints.resolve({
                "hints": hints,
                "enableDescription": true,
                "selectInitial": token && /\S/.test(token) && isNaN(parseInt(token, 10)) // If the active token is blank then don't put default selection
            });
        }).fail(function () {
            $deferredHints.reject();
        });

        return $deferredHints;
    };

    CodeHintsProvider.prototype.insertHint = function ($hint) {
        return this.defaultCodeHintProviders.insertHint($hint);
    };

    CodeHintsProvider.prototype.updateHintDescription = function ($hint, $hintDescContainer) {
        var $hintObj = $hint.find('.brackets-hints-with-type-details'),
            token = $hintObj.data('completionItem'),
            $desc = $('<div>');

        if(!token) {
            $hintDescContainer.empty();
            return;
        }

        if (token.detail) {
            if (token.detail.trim() !== '?') {
                $('<div>' + token.detail.split('->').join(':').toString().trim() + '</div>').appendTo($desc).addClass("codehint-desc-type-details");
            }
        } else {
            if (hintType[token.kind]) {
                $('<div>' + hintType[token.kind] + '</div>').appendTo($desc).addClass("codehint-desc-type-details");
            }
        }
        if (token.documentation) {
            $('<div></div>').html(token.documentation.trim()).appendTo($desc).addClass("codehint-desc-documentation");
        }

        //To ensure CSS reflow doesn't cause a flicker.
        $hintDescContainer.empty();
        $hintDescContainer.append($desc);
    };

    exports.CodeHintsProvider = CodeHintsProvider;
});
