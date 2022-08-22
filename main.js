define(function (require, exports, module) {
    "use strict";

    var LanguageTools = brackets.getModule("languageTools/LanguageTools"),
        ClientLoader = brackets.getModule("languageTools/ClientLoader"),
        AppInit = brackets.getModule("utils/AppInit"),
        ExtensionUtils = brackets.getModule("utils/ExtensionUtils"),
        ProjectManager = brackets.getModule("project/ProjectManager"),
        EditorManager =  brackets.getModule("editor/EditorManager"),
        LanguageManager =  brackets.getModule("language/LanguageManager"),
        CodeHintManager = brackets.getModule("editor/CodeHintManager"),
        QuickOpen = brackets.getModule("search/QuickOpen"),
        ParameterHintManager = brackets.getModule("features/ParameterHintsManager"),
        JumpToDefManager = brackets.getModule("features/JumpToDefManager"),
        FindReferencesManager = brackets.getModule("features/FindReferencesManager"),
        CodeInspection = brackets.getModule("language/CodeInspection"),
        DefaultProviders = brackets.getModule("languageTools/DefaultProviders"),
        CodeHintsProvider = require("src/CodeHintsProvider").CodeHintsProvider,
        SymbolProviders = require("src/TSSymbolProviders").SymbolProviders,
        DefaultEventHandlers = brackets.getModule("languageTools/DefaultEventHandlers"),
        PreferencesManager  = brackets.getModule("preferences/PreferencesManager"),
        Strings             = brackets.getModule("strings"),
        Dialogs             = brackets.getModule("widgets/Dialogs"),
        DefaultDialogs      = brackets.getModule("widgets/DefaultDialogs"),
        Commands               = brackets.getModule("command/Commands"),
        CommandManager         = brackets.getModule("command/CommandManager"),
        StringUtils             = brackets.getModule("utils/StringUtils");

    var clientFilePath = ExtensionUtils.getModulePath(module, "src/client.js"),
        clientName = "TypeScriptClient",
        _client = null,
        evtHandler,
        typescriptConfig = {
            executablePath: "node",
            validateOnType: "false"
        },
        DEBUG_OPEN_PREFERENCES_IN_SPLIT_VIEW  = "debug.openPrefsInSplitView",
        typescriptServerRunning = false,
        serverCapabilities,
        currentRootPath,
        chProvider = null,
        phProvider = null,
        lProvider = null,
        jdProvider = null,
        dSymProvider = null,
        pSymProvider = null,
        refProvider = null,
        providersRegistered = false;

    PreferencesManager.definePreference("typescript", "object", typescriptConfig, {
        description: Strings.DESCRIPTION_TYPESCRIPT_TOOLING_CONFIGURATION
    });

    PreferencesManager.on("change", "typescript", function () {
        var newTypescriptConfig = PreferencesManager.get("typescript");

        if (lProvider && newTypescriptConfig["validateOnType"] !== typescriptConfig["validateOnType"]) {
            lProvider._validateOnType = !(newTypescriptConfig["validateOnType"] === "false");
        }
        if ((newTypescriptConfig["executablePath"] !== typescriptConfig["executablePath"])) {
            typescriptConfig = newTypescriptConfig;
            runTypescriptServer();
            return;
        }
        typescriptConfig = newTypescriptConfig;
    });

    var handleProjectOpen = function (event, directory) {
        lProvider.clearExistingResults();
        if(serverCapabilities["workspace"] && serverCapabilities["workspace"]["workspaceFolders"]) {
            _client.notifyProjectRootsChanged({
                foldersAdded: [directory.fullPath],
                foldersRemoved: [currentRootPath]
            });
            currentRootPath = directory.fullPath;
        } else {
            _client.restart({
                rootPath: directory.fullPath
            }).done(handlePostTypescriptServerStart);
        }
    };

    function resetClientInProviders() {
        var logErr = "TypescriptTooling: Can't reset client for : ";
        chProvider ? chProvider.setClient(_client) : console.log(logErr, "CodeHintsProvider");
        phProvider ? phProvider.setClient(_client) : console.log(logErr, "ParameterHintsProvider");
        jdProvider ? jdProvider.setClient(_client) : console.log(logErr, "JumpToDefProvider");
        dSymProvider ? dSymProvider.setClient(_client) : console.log(logErr, "DocumentSymbolsProvider");
        pSymProvider ? pSymProvider.setClient(_client) : console.log(logErr, "ProjectSymbolsProvider");
        refProvider ? refProvider.setClient(_client) : console.log(logErr, "FindReferencesProvider");
        lProvider ? lProvider.setClient(_client) : console.log(logErr, "LintingProvider");
        _client.addOnCodeInspection(lProvider.setInspectionResults.bind(lProvider));
    }

    function registerToolingProviders() {
        chProvider = new CodeHintsProvider(_client),
        phProvider = new DefaultProviders.ParameterHintsProvider(_client),
        lProvider = new DefaultProviders.LintingProvider(_client),
        jdProvider = new DefaultProviders.JumpToDefProvider(_client);
        dSymProvider = new SymbolProviders.DocumentSymbolsProvider(_client);
        pSymProvider = new SymbolProviders.ProjectSymbolsProvider(_client);
        refProvider = new DefaultProviders.ReferencesProvider(_client);

        JumpToDefManager.registerJumpToDefProvider(jdProvider, ["typescript", "tsx"], 0);
        CodeHintManager.registerHintProvider(chProvider, ["typescript", "tsx"], 0);
        ParameterHintManager.registerHintProvider(phProvider, ["typescript", "tsx"], 0);
        FindReferencesManager.registerFindReferencesProvider(refProvider, ["typescript", "tsx"], 0);
        FindReferencesManager.setMenuItemStateForLanguage();
        CodeInspection.register(["typescript", "tsx"], {
            name: "typescript-lsp",
            scanFileAsync: lProvider.getInspectionResultsAsync.bind(lProvider)
        });
        //Attach plugin for Document Symbols
        QuickOpen.addQuickOpenPlugin({
            name: "TypeScript Document Symbols",
            label: Strings.CMD_FIND_DOCUMENT_SYMBOLS + "\u2026",
            languageIds: ["typescript, tsx"],
            search: dSymProvider.search.bind(dSymProvider),
            match: dSymProvider.match.bind(dSymProvider),
            itemFocus: dSymProvider.itemFocus.bind(dSymProvider),
            itemSelect: dSymProvider.itemSelect.bind(dSymProvider),
            resultsFormatter: dSymProvider.resultsFormatter.bind(dSymProvider)
        });
        CommandManager.get(Commands.NAVIGATE_GOTO_DEFINITION).setEnabled(true);
        //Attach plugin for Project Symbols
        QuickOpen.addQuickOpenPlugin({
            name: "TypeScript Project Symbols",
            label: Strings.CMD_FIND_PROJECT_SYMBOLS + "\u2026",
            languageIds: ["typescript, tsx"],
            search: pSymProvider.search.bind(pSymProvider),
            match: pSymProvider.match.bind(pSymProvider),
            itemFocus: pSymProvider.itemFocus.bind(pSymProvider),
            itemSelect: pSymProvider.itemSelect.bind(pSymProvider),
            resultsFormatter: pSymProvider.resultsFormatter.bind(pSymProvider)
        });
        CommandManager.get(Commands.NAVIGATE_GOTO_DEFINITION_PROJECT).setEnabled(true);

        _client.addOnCodeInspection(lProvider.setInspectionResults.bind(lProvider));

        providersRegistered = true;
    }

    function addEventHandlers() {
        _client.addOnLogMessage(function () {});
        _client.addOnShowMessage(function () {});
        evtHandler = new DefaultEventHandlers.EventPropagationProvider(_client);
        evtHandler.registerClientForEditorEvent();


        if (typescriptConfig["validateOnType"] !== "false") {
            lProvider._validateOnType = true;
        }

        _client.addOnProjectOpenHandler(handleProjectOpen);
    }
    
    function validateNodeExecutable() {
        var result = $.Deferred();

        _client.sendCustomRequest({
            messageType: "brackets",
            type: "validateNodeExecutable",
            params: typescriptConfig
        }).done(result.resolve).fail(result.reject);

        return result;
    }

    function showErrorPopUp(err) {
        if(!err) {
            return;
        }
        var localizedErrStr = "";
        if (typeof (err) === "string") {
            localizedErrStr = Strings[err];
        } else {
            localizedErrStr = StringUtils.format(Strings[err[0]], err[1]);
        }
        if(!localizedErrStr) {
            console.error("TypeScript Tooling Error: " + err);
            return;
        }
        var Buttons = [
            { className: Dialogs.DIALOG_BTN_CLASS_NORMAL, id: Dialogs.DIALOG_BTN_CANCEL,
                text: Strings.CANCEL },
            { className: Dialogs.DIALOG_BTN_CLASS_PRIMARY, id: Dialogs.DIALOG_BTN_DOWNLOAD,
                text: Strings.OPEN_PREFERENNCES}
        ];
        Dialogs.showModalDialog(
            DefaultDialogs.DIALOG_ID_ERROR,
            "TypeScript",
            localizedErrStr,
            Buttons
        ).done(function (id) {
            if (id === Dialogs.DIALOG_BTN_DOWNLOAD) {
                if (CommandManager.get(DEBUG_OPEN_PREFERENCES_IN_SPLIT_VIEW)) {
                    CommandManager.execute(DEBUG_OPEN_PREFERENCES_IN_SPLIT_VIEW);
                } else {
                    CommandManager.execute(Commands.CMD_OPEN_PREFERENCES);
                }
            }
        });
    }

    function handlePostTypescriptServerStart() {
        if (!typescriptServerRunning) {
            typescriptServerRunning = true;

            if (providersRegistered) {
                resetClientInProviders();
            } else {
                registerToolingProviders();
            }

            addEventHandlers();
            EditorManager.off("activeEditorChange.typescript");
            EditorManager.off("activeEditorChange.tsx");
            LanguageManager.off("languageModified.typescript");
            LanguageManager.off("languageModified.tsx");
        }
        evtHandler.handleActiveEditorChange(null, EditorManager.getActiveEditor());
        currentRootPath = ProjectManager.getProjectRoot()._path;
    }

    function runTypescriptServer() {
        if (_client) {
             validateNodeExecutable()
                .done(function () {
                    var startFunc = _client.start.bind(_client);
                    if (typescriptServerRunning) {
                        startFunc = _client.restart.bind(_client);
                    }
                    currentRootPath = ProjectManager.getProjectRoot()._path;
                    startFunc({
                        rootPath: currentRootPath
                    }).done(function (result) {
                        console.log("typescript Language Server started");
                        serverCapabilities = result.capabilities;
                        handlePostTypescriptServerStart();
                    });
                }).fail(showErrorPopUp);
        }
    }

    function activeEditorChangeHandler(event, current) {
        if (current) {
            var language = current.document.getLanguage();
            if (language.getId() === "typescript" || language.getId() === "tsx") {
                runTypescriptServer();
                EditorManager.off("activeEditorChange.typescript");
                EditorManager.off("activeEditorChange.tsx");
                LanguageManager.off("languageModified.typescript");
                LanguageManager.off("languageModified.tsx");
            }
        }
    }

    function languageModifiedHandler(event, language) {
        if (language && (language.getId() === "typescript" || language.getId() === "tsx")) {
            runTypescriptServer();
            EditorManager.off("activeEditorChange.typescript");
            EditorManager.off("activeEditorChange.tsx");
            LanguageManager.off("languageModified.typescript");
            LanguageManager.off("languageModified.tsx");
        }
    }

    function initiateService(evt, onAppReady) {
        if (onAppReady) {
            console.log("Typescript tooling: Starting the service");
        } else {
            console.log("Typescript tooling: Something went wrong. Restarting the service");
        }

        typescriptServerRunning = false;
        LanguageTools.initiateToolingService(clientName, clientFilePath, ['typescript', 'tsx']).done(function (client) {
            _client = client;
            //Attach only once
            EditorManager.off("activeEditorChange.typescript");
            EditorManager.on("activeEditorChange.typescript", activeEditorChangeHandler);
            EditorManager.off("activeEditorChange.tsx");
            EditorManager.on("activeEditorChange.tsx", activeEditorChangeHandler);
            //Attach only once
            LanguageManager.off("languageModified.typescript");
            LanguageManager.on("languageModified.typescript", languageModifiedHandler);
            LanguageManager.off("languageModified.tsx");
            LanguageManager.on("languageModified.tsx", languageModifiedHandler);
            activeEditorChangeHandler(null, EditorManager.getActiveEditor());
        });
    }

    AppInit.appReady(function () {
        initiateService(null, true);
        ClientLoader.on("languageClientModuleInitialized", initiateService);
    });

    //Only for Unit testing
    exports.getClient = function() { return _client; };
});
