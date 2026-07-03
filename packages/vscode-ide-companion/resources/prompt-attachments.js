(function () {
  const ATTACHMENT_LABEL = "粘贴的图像";
  const PREVIEW_OFFSET = 10;

  function createElement(tagName, className) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    return element;
  }

  function isImageFile(file) {
    return Boolean(file && typeof file.type === "string" && file.type.startsWith("image/"));
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
      reader.readAsDataURL(file);
    });
  }

  function pickImageFileFromClipboard(event) {
    const items = Array.from(event.clipboardData?.items || []);
    for (const item of items) {
      if (item.kind !== "file") {
        continue;
      }
      const file = item.getAsFile();
      if (isImageFile(file)) {
        return file;
      }
    }
    return null;
  }

  function createPromptAttachmentManager(options) {
    const promptInput = options?.promptInput;
    const inputWrap = options?.inputWrap;
    const toolsLine = options?.toolsLine;
    const onAttachmentChange =
      typeof options?.onAttachmentChange === "function" ? options.onAttachmentChange : function () {};

    if (!promptInput || !inputWrap || !toolsLine) {
      throw new Error("Prompt attachment manager requires promptInput, inputWrap, and toolsLine.");
    }

    let attachments = [];
    let nextAttachmentId = 0;
    let previewPopup = null;
    let previewImage = null;
    let previewAnchor = null;

    function ensurePreviewPopup() {
      if (previewPopup) {
        return;
      }

      previewPopup = createElement("div", "chat-attached-context-preview");
      previewImage = createElement("img", "chat-attached-context-preview-image");
      previewImage.alt = ATTACHMENT_LABEL;
      previewPopup.appendChild(previewImage);
      document.body.appendChild(previewPopup);
    }

    function hidePreview() {
      if (!previewPopup) {
        return;
      }
      previewAnchor = null;
      previewPopup.classList.remove("show");
    }

    function updatePreviewPosition(anchor) {
      if (!previewPopup || !anchor) {
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const popupRect = previewPopup.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = rect.left;
      let top = rect.top - popupRect.height - PREVIEW_OFFSET;

      if (left + popupRect.width > viewportWidth - 12) {
        left = viewportWidth - popupRect.width - 12;
      }
      if (left < 12) {
        left = 12;
      }
      if (top < 12) {
        top = rect.bottom + PREVIEW_OFFSET;
      }
      if (top + popupRect.height > viewportHeight - 12) {
        top = Math.max(12, viewportHeight - popupRect.height - 12);
      }

      previewPopup.style.left = left + "px";
      previewPopup.style.top = top + "px";
    }

    function showPreview(anchor, attachment) {
      if (!attachment) {
        return;
      }

      ensurePreviewPopup();
      previewAnchor = anchor;
      previewImage.src = attachment.dataUrl;
      previewPopup.classList.add("show");
      updatePreviewPosition(anchor);
    }

    function emitChange() {
      onAttachmentChange({
        hasAttachments: attachments.length > 0,
        attachments: attachments.slice(),
      });
    }

    function clear() {
      attachments = [];
      toolsLine.innerHTML = "";
      toolsLine.classList.remove("has-attachment");
      hidePreview();
      emitChange();
    }

    function removeAttachment(id) {
      const nextAttachments = attachments.filter((attachment) => attachment.id !== id);
      if (nextAttachments.length === attachments.length) {
        return;
      }
      attachments = nextAttachments;
      render();
      emitChange();
    }

    function createAttachmentNode(attachment) {
      const wrapper = createElement("div", "chat-attached-context-attachment show-file-icons");
      wrapper.tabIndex = 0;
      wrapper.setAttribute("role", "button");
      wrapper.setAttribute("aria-label", ATTACHMENT_LABEL + " (删除)");
      wrapper.dataset.attachmentId = String(attachment.id);
      wrapper.draggable = true;

      const removeButton = createElement("a", "monaco-button codicon codicon-close");
      removeButton.tabIndex = -1;
      removeButton.setAttribute("role", "button");
      removeButton.setAttribute("aria-label", "从上下文中移除");
      removeButton.href = "#";
      removeButton.textContent = "×";
      removeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeAttachment(attachment.id);
      });

      const iconLabel = createElement("div", "monaco-icon-label");
      const iconLabelContainer = createElement("div", "monaco-icon-label-container");
      const iconNameContainer = createElement("span", "monaco-icon-name-container");
      iconLabelContainer.appendChild(iconNameContainer);
      iconLabel.appendChild(iconLabelContainer);

      const pill = createElement("div", "chat-attached-context-pill");
      const image = createElement("img", "chat-attached-context-pill-image");
      image.src = attachment.dataUrl;
      image.alt = ATTACHMENT_LABEL;
      pill.appendChild(image);

      const text = createElement("span", "chat-attached-context-custom-text");
      text.textContent = ATTACHMENT_LABEL;

      wrapper.appendChild(removeButton);
      wrapper.appendChild(iconLabel);
      wrapper.appendChild(pill);
      wrapper.appendChild(text);

      const show = () => showPreview(wrapper, attachment);
      wrapper.addEventListener("mouseenter", show);
      wrapper.addEventListener("focus", show);
      wrapper.addEventListener("mouseleave", hidePreview);
      wrapper.addEventListener("blur", hidePreview);
      wrapper.addEventListener("dragstart", (event) => {
        event.preventDefault();
      });
      wrapper.addEventListener("keydown", (event) => {
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          removeAttachment(attachment.id);
        }
      });

      return wrapper;
    }

    function render() {
      toolsLine.innerHTML = "";
      toolsLine.classList.toggle("has-attachment", attachments.length > 0);
      if (attachments.length === 0) {
        hidePreview();
        return;
      }
      for (const attachment of attachments) {
        toolsLine.appendChild(createAttachmentNode(attachment));
      }
      if (previewAnchor && !toolsLine.contains(previewAnchor)) {
        hidePreview();
      }
    }

    function addAttachmentData(data) {
      if (!data?.dataUrl) {
        return false;
      }

      nextAttachmentId += 1;
      attachments.push({
        id: nextAttachmentId,
        name: data.name || ATTACHMENT_LABEL,
        mimeType: data.mimeType || "image/png",
        dataUrl: data.dataUrl,
        label: ATTACHMENT_LABEL,
      });
      render();
      emitChange();
      return true;
    }

    async function addAttachmentFromFile(file) {
      if (!isImageFile(file)) {
        return false;
      }

      const dataUrl = await readFileAsDataUrl(file);
      return addAttachmentData({
        name: file.name || ATTACHMENT_LABEL,
        mimeType: file.type || "image/png",
        dataUrl,
        label: ATTACHMENT_LABEL,
      });
    }

    async function handlePaste(event) {
      const file = pickImageFileFromClipboard(event);
      if (!file) {
        return;
      }

      event.preventDefault();
      try {
        await addAttachmentFromFile(file);
      } catch (error) {
        console.error("Failed to attach pasted image.", error);
      }
    }

    promptInput.addEventListener("paste", handlePaste);

    window.addEventListener("resize", () => {
      if (previewPopup?.classList.contains("show") && previewAnchor) {
        updatePreviewPosition(previewAnchor);
      }
    });

    window.addEventListener(
      "scroll",
      () => {
        if (previewPopup?.classList.contains("show") && previewAnchor) {
          updatePreviewPosition(previewAnchor);
        }
      },
      true
    );

    return {
      clear,
      hasAttachments() {
        return attachments.length > 0;
      },
      getImageUrls() {
        return attachments.map((attachment) => attachment.dataUrl);
      },
    };
  }

  window.createPromptAttachmentManager = createPromptAttachmentManager;
})();
