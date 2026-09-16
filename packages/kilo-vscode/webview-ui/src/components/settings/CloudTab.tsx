import { Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import SettingsRow from "./SettingsRow"

const CloudTab: Component = () => {
  const language = useLanguage()
  const vscode = useVSCode()

  return (
    <Card>
      <SettingsRow title={language.t("settings.cloud.title")} description={language.t("settings.cloud.description")}>
        <Button
          variant="secondary"
          size="small"
          onClick={() => vscode.postMessage({ type: "openExternal", url: "command:babel-code.new.cloud.signIn" })}
        >
          {language.t("settings.cloud.signIn")}
        </Button>
      </SettingsRow>
    </Card>
  )
}

export default CloudTab
