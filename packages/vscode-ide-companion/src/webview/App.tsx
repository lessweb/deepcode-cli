import Header from "@/webview/components/Header";
import Messages from "@/webview/components/Messages";
import InputPrompt from "@/webview/components/InputPrompt";
import ThinkingLiveBubble from "@/webview/components/ThinkingLiveBubble";
import PermissionPrompt from "@/webview/components/PermissionPrompt";
import { useChat } from "@/webview/context/ChatProvider";

export default function App() {
  const { state, dispatch, actions } = useChat();

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        sessions={state.sessions}
        activeSessionId={state.activeSessionId}
        onSelectSession={actions.selectSession}
        onCreateNewSession={actions.createNewSession}
      />
      <Messages
        messages={state.messages}
        loading={state.loading}
        llmStreamProgress={state.llmStreamProgress}
        processes={state.processes}
        onEditMessage={actions.editMessage}
      />
      <PermissionPrompt
        askPermissions={state.askPermissions}
        sessionStatus={state.activeSessionStatus}
        pendingPermissionReply={state.pendingPermissionReply}
        permissionPromptState={state.permissionPromptState}
        dispatch={dispatch}
        onDenyPermission={actions.denyPermission}
        onSendPrompt={actions.sendPrompt}
        activeSessionId={state.activeSessionId}
        onInterrupt={actions.interrupt}
      />
      {state.loading && (
        <ThinkingLiveBubble
          llmStreamProgress={state.llmStreamProgress}
          processes={state.processes}
          shouldConnect={state.lastMessageRole !== null && state.lastMessageRole !== "user"}
        />
      )}
      <InputPrompt
        loading={state.loading}
        selectedSkills={state.selectedSkills}
        availableSkills={state.skills}
        pendingPermissionReply={state.pendingPermissionReply}
        askPermissions={state.askPermissions}
        activeSessionStatus={state.activeSessionStatus}
        tokenTelemetry={state.tokenTelemetry}
        activeEditor={state.activeEditor}
        editingMessage={state.editingMessage}
        messages={state.messages}
        onSendPrompt={actions.sendPrompt}
        onInterrupt={actions.interrupt}
        onSelectSkills={actions.setSelectedSkills}
        onClearEditingMessage={() => actions.editMessage(null)}
      />
    </div>
  );
}
