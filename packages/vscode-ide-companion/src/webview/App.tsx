import { useCallback, useRef } from "react";
import Header from "@/webview/components/Header";
import Messages from "@/webview/components/Messages";
import InputPrompt from "@/webview/components/InputPrompt";
import ThinkingLiveBubble from "@/webview/components/ThinkingLiveBubble";
import PermissionPrompt from "@/webview/components/PermissionPrompt";
import ContinuePrompt from "@/webview/components/ContinuePrompt";
import { useChat } from "@/webview/context/ChatProvider";
import AskQuestionCarousel from "@/webview/components/AskQuestionCarousel";
import type { AskUserQuestionMetadata } from "@/webview/components/bubbles/ToolBubble";

export default function App() {
  const { state, dispatch, actions } = useChat();
  const messagesRef = useRef(null);

  const handleAskUserQuestions = useCallback(
    (questions: AskUserQuestionMetadata["questions"]) => {
      dispatch({ type: "SET_ASK_USER_QUESTIONS", data: { questions } });
    },
    [dispatch]
  );

  return (
    <div className="relative flex flex-col h-screen min-h-screen w-full overflow-hidden">
      <Header
        sessions={state.sessions}
        activeSessionId={state.activeSessionId}
        onSelectSession={actions.selectSession}
        onCreateNewSession={actions.createNewSession}
        onRenameSession={actions.renameSession}
        onDeleteSession={actions.deleteSession}
      />
      <Messages
        ref={messagesRef}
        messages={state.messages}
        loading={state.loading}
        onEditMessage={actions.editMessage}
        onAskUserQuestions={handleAskUserQuestions}
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
      {state.showContinuePrompt && (
        <ContinuePrompt onContinue={actions.continueGeneration} onDismiss={actions.dismissContinuePrompt} />
      )}
      {state.loading && (
        <ThinkingLiveBubble
          llmStreamProgress={state.llmStreamProgress}
          processes={state.processes}
          // shouldConnect={state.lastMessageRole !== null && state.lastMessageRole !== "user"}
        />
      )}
      {state.askUserQuestions && (
        <AskQuestionCarousel
          questions={state.askUserQuestions.questions}
          onClose={() => dispatch({ type: "SET_ASK_USER_QUESTIONS", data: null })}
        />
      )}
      <InputPrompt
        loading={state.loading}
        selectedSkills={state.selectedSkills}
        availableSkills={state.skills}
        pendingPermissionReply={state.pendingPermissionReply}
        // askPermissions={state.askPermissions}
        // activeSessionStatus={state.activeSessionStatus}
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
