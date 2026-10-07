!macro customInit
  # =========================================================================
  # Prevent Installer from Invoking Old Uninstaller during Upgrades
  # =========================================================================
  # By default, electron-builder's installer executes the existing on-disk
  # uninstaller to remove the previous version before extracting new files.
  # If the existing uninstaller requires administrator elevation, it would
  # trigger a UAC password prompt during normal user installation/updates.
  # By clearing UninstallString here, the installer skips executing the old
  # uninstaller and directly updates the files cleanly in place.
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString"
!macroend

!macro customUnInit
  # If the uninstaller is invoked internally by the installer during an install/update,
  # electron-builder sets the "updated" flag (${isUpdated}).
  # Do NOT prompt for admin credentials during installation or automatic updates!
  ${IfNot} ${isUpdated}
    # =========================================================================
    # WorkLens Admin-Only Uninstallation Guard
    # =========================================================================
    # Standard users must NOT be able to uninstall WorkLens without valid
    # Windows Administrator credentials.
    # =========================================================================

    ${IfNot} ${UAC_IsAdmin}
      # Current uninstaller instance is running without administrator privileges (Medium Integrity Level).
      # Hide uninstaller window if any is displayed
      ShowWindow $HWNDPARENT ${SW_HIDE}

      # Request Windows UAC elevation.
      # On a standard user account, Windows displays the UAC Credential Prompt requiring
      # an Administrator username and password.
      !insertmacro UAC_RunElevated

      ${If} $0 == 0
      ${AndIf} $1 == 1
        # Elevated child process was launched and completed execution ($1 == 1).
        ${If} $2 == 0
          # The elevated child process exited successfully (ExitCode 0).
          # Clean up the current standard user's uninstall registry key and shortcuts.
          # This handles Over-The-Shoulder (OTS) elevation where the elevated child
          # operated as a different administrator account.
          DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
          DeleteRegKey HKCU "Software\${APP_GUID}"
          DeleteRegKey HKCU "Software\${APP_PACKAGE_NAME}"
          DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Run\WorkLensWatchdog"
          Delete "$DESKTOP\${PRODUCT_FILENAME}.lnk"
          Delete "$SMPROGRAMS\${PRODUCT_FILENAME}.lnk"
        ${EndIf}
        Quit
      ${Else}
        # The elevation dialog was cancelled ($0 == 1223) or failed.
        # Abort uninstallation immediately without deleting any files or registry entries.
        Quit
      ${EndIf}
    ${EndIf}

    # =========================================================================
    # Elevated Administrator Instance (High Integrity Level)
    # =========================================================================
    # In an Over-The-Shoulder (OTS) elevation scenario, $LocalAppData and HKCU
    # resolve to the administrator's profile rather than the employee's profile.
    # However, $EXEDIR is ALWAYS the true directory containing "Uninstall WorkLens.exe"
    # (e.g. C:\Users\<Employee>\AppData\Local\Programs\worklens).
    # We firmly lock $INSTDIR to $EXEDIR so the correct directory is uninstalled.
    ${If} ${FileExists} "$EXEDIR\WorkLens.exe"
      StrCpy $INSTDIR $EXEDIR
    ${EndIf}
  ${EndIf}
!macroend
