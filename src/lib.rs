use std::{env, fs};

use zed_extension_api::{self as zed, Result};

const SERVER_PATH: &str = "server/quick-ux-js-language-server.js";
const SERVER_SCRIPT: &str = include_str!("../server/quick-ux-js-language-server.js");
const TYPESCRIPT_PACKAGE_NAME: &str = "typescript";
const TYPESCRIPT_VERSION: &str = "6.0.3";
const PRETTIER_PACKAGE_NAME: &str = "prettier";
const PRETTIER_VERSION: &str = "3.7.4";
const PRETTIER_PLUGIN_PACKAGE_NAME: &str = "prettier-plugin-ux";
const PRETTIER_PLUGIN_VERSION: &str = "0.3.0";

struct QuickUxExtension {
    did_find_server: bool,
}

impl QuickUxExtension {
    fn server_exists(&self) -> bool {
        fs::metadata(SERVER_PATH).is_ok_and(|stat| stat.is_file())
    }

    fn write_server_script(&self) -> Result<()> {
        fs::create_dir_all("server")
            .map_err(|err| format!("failed to create bundled server directory: {err}"))?;
        fs::write(SERVER_PATH, SERVER_SCRIPT)
            .map_err(|err| format!("failed to write bundled server script: {err}"))?;
        Ok(())
    }

    fn typescript_exists(&self) -> bool {
        fs::metadata("node_modules/typescript/lib/typescript.js").is_ok_and(|stat| stat.is_file())
    }

    fn prettier_exists(&self) -> bool {
        fs::metadata("node_modules/prettier/index.cjs").is_ok_and(|stat| stat.is_file())
    }

    fn prettier_plugin_exists(&self) -> bool {
        fs::metadata("node_modules/prettier-plugin-ux/src/index.js")
            .is_ok_and(|stat| stat.is_file())
    }

    fn dependencies_exist(&self) -> bool {
        self.typescript_exists() && self.prettier_exists() && self.prettier_plugin_exists()
    }

    fn ensure_server(&mut self, language_server_id: &zed::LanguageServerId) -> Result<String> {
        self.write_server_script()?;

        if self.did_find_server && self.server_exists() && self.dependencies_exist() {
            return Ok(SERVER_PATH.to_string());
        }

        if !self.server_exists() {
            return Err(format!(
                "missing bundled language server script: {SERVER_PATH}"
            ));
        }

        if !self.typescript_exists() {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::CheckingForUpdate,
            );
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            zed::npm_install_package(TYPESCRIPT_PACKAGE_NAME, TYPESCRIPT_VERSION)?;
        }

        if !self.prettier_exists() {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            zed::npm_install_package(PRETTIER_PACKAGE_NAME, PRETTIER_VERSION)?;
        }

        if !self.prettier_plugin_exists() {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            zed::npm_install_package(PRETTIER_PLUGIN_PACKAGE_NAME, PRETTIER_PLUGIN_VERSION)?;
        }

        self.did_find_server = true;
        Ok(SERVER_PATH.to_string())
    }
}

impl zed::Extension for QuickUxExtension {
    fn new() -> Self {
        Self {
            did_find_server: false,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let server_path = self.ensure_server(language_server_id)?;

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                env::current_dir()
                    .unwrap()
                    .join(server_path)
                    .to_string_lossy()
                    .to_string(),
            ],
            env: Default::default(),
        })
    }
}

zed::register_extension!(QuickUxExtension);
