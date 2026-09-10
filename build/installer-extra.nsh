; —— 安装向导「开机自启」自定义页（选完安装目录后、开始安装前）——
; 与托盘「开机自启」开关共用同一 HKCU Run 值：Electron setLoginItemSettings 写的
; 值名是应用名 DeepSeekWhale、内容是 "exe" "目录"；这里写同样的格式，两边互相可见。
; 静默安装（/S）不弹页也不动 Run 键，保留用户现状。
!include "nsDialogs.nsh"

; 卸载器编译趟（BUILD_UNINSTALLER）不插自定义页，这两个 Var 会变成未引用
; 警告（模板把警告当错误），所以只在安装器趟声明
!ifndef BUILD_UNINSTALLER
  Var WhaleAutostartCheckbox
  Var WhaleAutostartChecked
!endif

!macro customPageAfterChangeDir
  Page custom WhaleAutostartPageCreate WhaleAutostartPageLeave
  Function WhaleAutostartPageCreate
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateCheckbox} 0 0 100% 14u "开机自启：登录 Windows 后自动启动小鲸鱼（安装后可随时在托盘菜单关闭）"
    Pop $WhaleAutostartCheckbox
    ${NSD_SetState} $WhaleAutostartCheckbox ${BST_CHECKED}
    StrCpy $WhaleAutostartChecked ${BST_CHECKED}
    nsDialogs::Show
  FunctionEnd
  Function WhaleAutostartPageLeave
    ${NSD_GetState} $WhaleAutostartCheckbox $WhaleAutostartChecked
  FunctionEnd
!macroend

!macro customInstall
  ${IfNot} ${Silent}
    ${If} $WhaleAutostartChecked == ${BST_CHECKED}
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DeepSeekWhale" '"$INSTDIR\${APP_FILENAME}.exe" "$INSTDIR"'
    ${Else}
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DeepSeekWhale"
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DeepSeekWhale"
!macroend
