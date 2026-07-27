import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/webview/components/ui/dropdown-menu";
import { FileText, ImageUp, Plus } from "lucide-react";
import { InputGroupButton } from "@/webview/components/ui/input-group";
import { chatService } from "@/webview/services/chatService";

interface AttachmentsProps {
  onUploadImages?: (files: Array<{ name: string; mimeType: string; dataUrl: string }>) => void;
}

const Attachments: React.FC<AttachmentsProps> = ({ onUploadImages }) => {
  const handleUploadFromComputer = async () => {
    try {
      const result = await chatService.pickImageFiles();
      if (result.files && result.files.length > 0 && onUploadImages) {
        onUploadImages(result.files);
      }
    } catch (err) {
      console.error("[Attachments] Failed to pick image files:", err);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <InputGroupButton
          size="xs"
          className="text-xs text-muted-foreground cursor-pointer"
          title="Show command menu (/)"
        >
          <Plus className="h-3 w-3" />
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52">
        <DropdownMenuItem title="Attach files from your computer" onClick={handleUploadFromComputer}>
          <ImageUp />
          <span>Upload from computer</span>
        </DropdownMenuItem>
        <DropdownMenuItem title="Add files or folders to the conversation" disabled>
          <FileText />
          <span>Add context</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default Attachments;
