// Placeholder-Manager 확장 - 드롭다운 기반 플레이스홀더 관리
import { extension_settings, getContext, loadExtensionSettings, renderExtensionTemplateAsync } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { SlashCommandParser } from "../../../slash-commands/SlashCommandParser.js";
import { ARGUMENT_TYPE, SlashCommandNamedArgument } from "../../../slash-commands/SlashCommandArgument.js";
import { POPUP_RESULT, POPUP_TYPE, Popup } from "../../../popup.js";

// 확장 설정
const extensionName = "Placeholder-Manager";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];
const defaultSettings = {
    placeholders: []
};

// SillyTavern 시스템 예약어 목록
const RESERVED_WORDS = [
    // System-wide Replacement Macros
    'pipe', 'newline', 'trim', 'noop', 'original', 'input', 'lastGenerationType',
    'charPrompt', 'charInstruction', 'description', 'personality', 'scenario', 'persona',
    'mesExamples', 'mesExamplesRaw', 'summary', 'user', 'char', 'version', 'charDepthPrompt',
    'group', 'charIfNotGroup', 'groupNotMuted', 'model', 'lastMessage', 'lastUserMessage',
    'lastCharMessage', 'lastMessageId', 'firstIncludedMessageId', 'firstDisplayedMessageId',
    'currentSwipeId', 'lastSwipeId', 'reverse', 'time', 'date', 'weekday', 'isotime',
    'isodate', 'datetimeformat', 'time_UTC', 'timeDiff', 'idle_duration', 'bias', 'roll',
    'random', 'pick', 'banned', 'isMobile',
    
    // Instruct Mode and Context Template Macros
    'maxPrompt', 'exampleSeparator', 'chatStart', 'systemPrompt', 'defaultSystemPrompt',
    'instructSystemPromptPrefix', 'instructSystemPromptSuffix', 'instructUserPrefix',
    'instructUserSuffix', 'instructAssistantPrefix', 'instructAssistantSuffix',
    'instructFirstAssistantPrefix', 'instructLastAssistantPrefix', 'instructSystemPrefix',
    'instructSystemSuffix', 'instructSystemInstructionPrefix', 'instructUserFiller',
    'instructStop', 'instructFirstUserPrefix', 'instructLastUserPrefix',
    
    // Chat variables Macros
    'getvar', 'setvar', 'addvar', 'incvar', 'decvar', 'getglobalvar', 'setglobalvar',
    'addglobalvar', 'incglobalvar', 'decglobalvar', 'var'
];

// 현재 선택된 플레이스홀더 ID
let selectedPlaceholderId = null;

// 설정 로드
async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
}

// 고유 ID 생성
function generateId() {
    return 'placeholder_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 변수명 입력 팝업 표시
async function showVariableNamePopup() {
    let success = false;
    
    while (!success) {
        const variableNameHtml = `
            <div class="flex-container flexFlowColumn">
                <p>플레이스홀더 변수명을 입력하세요:</p>
                <input type="text" id="variable-name-input" placeholder="예: character, setting, mood" maxlength="50" class="text_pole">
                <small style="color: var(--SmartThemeQuoteColor); opacity: 0.8; margin-top: 5px;">영문, 숫자, 언더스코어(_)만 사용 가능하며 숫자로 시작할 수 없습니다.</small>
            </div>
        `;
        
        const template = $(variableNameHtml);
        const popup = new Popup(template, POPUP_TYPE.CONFIRM, '변수명 입력', { 
            okButton: '확인', 
            cancelButton: '취소'
        });
        
        const result = await popup.show();
        
        if (!result) {
            // 취소 버튼을 눌렀거나 ESC로 닫았을 때
            return false;
        }
        
        const variableName = template.find('#variable-name-input').val().trim();
        
        // 변수명 유효성 검사
        if (!variableName) {
            alert('변수명을 입력해주세요.');
            continue; // 다시 입력 받기
        }
        
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(variableName)) {
            alert('변수명 형식이 올바르지 않습니다.\n영문, 숫자, 언더스코어(_)만 사용 가능하며\n숫자로 시작할 수 없습니다.');
            continue; // 다시 입력 받기
        }
        
        // 시스템 예약어 검사
        if (RESERVED_WORDS.includes(variableName.toLowerCase())) {
            alert(`'${variableName}'는 SillyTavern 시스템 예약어입니다.\n다른 이름을 사용해주세요.`);
            continue; // 다시 입력 받기
        }
        
        // 중복 검사
        const existingVariables = extension_settings[extensionName].placeholders.map(p => p.variable);
        if (existingVariables.includes(variableName)) {
            alert('이미 존재하는 변수명입니다.\n다른 이름을 사용해주세요.');
            continue; // 다시 입력 받기
        }
        
        // 새 플레이스홀더 생성
        const newPlaceholder = { 
            id: generateId(), 
            name: "새 플레이스홀더", 
            variable: variableName, 
            content: "" 
        };
        
        extension_settings[extensionName].placeholders.push(newPlaceholder);
        
        // 시스템에 즉시 적용
        applyPlaceholderToSystem(newPlaceholder);
        
        saveSettingsDebounced();
        success = true;
        
        // 새로 생성된 플레이스홀더를 선택
        selectedPlaceholderId = newPlaceholder.id;
    }
    
    return true;
}

// 플레이스홀더 창 열기
async function openPlaceholderManagerPopup() {
    const template = $(await renderExtensionTemplateAsync(`third-party/${extensionName}`, 'template'));
    
    // 첫 번째 플레이스홀더를 기본 선택
    const placeholders = extension_settings[extensionName].placeholders || [];
    if (placeholders.length > 0 && !selectedPlaceholderId) {
        selectedPlaceholderId = placeholders[0].id;
    }
    
    // 드롭다운과 편집 영역 렌더링
    renderDropdown(template);
    renderEditor(template);
    
    // 이벤트 리스너 추가
    setupEventListeners(template);
    
    const popup = new Popup(template, POPUP_TYPE.CONFIRM, '플레이스홀더 관리', { 
        wide: true, 
        large: true,
        okButton: '저장', 
        cancelButton: '취소'
    });
    
    const result = await popup.show();
    
         if (result) {
         // 플레이스홀더 설정 저장됨
     }
}

// 드롭다운 옵션 렌더링
function renderDropdown(template) {
    const placeholders = extension_settings[extensionName].placeholders || [];
    const dropdown = template.find('#placeholder-dropdown');
    const deleteBtn = template.find('#delete-placeholder-btn');
    
    dropdown.empty();
    
    if (placeholders.length === 0) {
        dropdown.append('<option value="">플레이스홀더가 없습니다</option>');
        dropdown.prop('disabled', true);
        deleteBtn.prop('disabled', true);
    } else {
        dropdown.prop('disabled', false);
        deleteBtn.prop('disabled', false);
        placeholders.forEach(placeholder => {
            const isSelected = placeholder.id === selectedPlaceholderId;
            const displayText = `{{${placeholder.variable}}}`;
            dropdown.append(`<option value="${placeholder.id}" ${isSelected ? 'selected' : ''}>${displayText}</option>`);
        });
    }
}

// 편집 영역 렌더링
function renderEditor(template) {
    const placeholders = extension_settings[extensionName].placeholders || [];
    const editorArea = template.find('#placeholder-editor-area');
    
    const selectedPlaceholder = placeholders.find(p => p.id === selectedPlaceholderId);
    
    if (!selectedPlaceholder) {
        // 플레이스홀더가 없거나 선택되지 않은 경우
        editorArea.html(`
            <div class="no-placeholders-message">
                <h3>+ 버튼을 클릭하여 새로운 플레이스홀더를 만들어보세요.</h3>
                <p>플레이스홀더를 사용하면 반복되는 텍스트를 효율적으로 관리할 수 있습니다.</p>
            </div>
        `);
        return;
    }
    
    const editorHtml = `
        <div class="placeholder-editor">
            <div class="placeholder-title-row">
                <input type="text" 
                       class="placeholder-title-input" 
                       placeholder="플레이스홀더 제목을 입력하세요" 
                       value="${selectedPlaceholder.name}"
                       data-id="${selectedPlaceholder.id}">
                <button class="placeholder-clear-content-btn" data-id="${selectedPlaceholder.id}" title="내용 지우기">
                    <i class="fa-solid fa-eraser"></i>
                </button>
            </div>
            <div class="placeholder-content-area">
                <textarea class="placeholder-textarea" 
                          placeholder="여기에 내용을 입력하세요..." 
                          data-id="${selectedPlaceholder.id}">${selectedPlaceholder.content}</textarea>
            </div>
        </div>
    `;
    
    editorArea.html(editorHtml);
}

// 플레이스홀더 선택
function selectPlaceholder(template, placeholderId) {
    selectedPlaceholderId = placeholderId;
    renderDropdown(template);
    renderEditor(template);
    setupEventListeners(template);
}

// 이벤트 리스너 설정
function setupEventListeners(template) {
    // 드롭다운 변경 이벤트
    template.find('#placeholder-dropdown').off('change').on('change', function() {
        const placeholderId = $(this).val();
        if (placeholderId) {
            selectPlaceholder(template, placeholderId);
        }
    });
    
    // + 버튼 클릭 이벤트
    template.find('#add-placeholder-btn').off('click').on('click', async function() {
        const success = await showVariableNamePopup();
        if (success) {
            renderDropdown(template);
            renderEditor(template);
            setupEventListeners(template);
        }
    });
    
    // 제목 입력 필드 변경 이벤트
    template.find('.placeholder-title-input').off('input').on('input', function() {
        const placeholderId = $(this).data('id');
        const newTitle = $(this).val();
        updatePlaceholderTitle(placeholderId, newTitle);
        // 드롭다운 옵션 즉시 업데이트
        renderDropdown(template);
        setupEventListeners(template);
    });
    
    // 내용 텍스트 에리어 변경 이벤트
    template.find('.placeholder-textarea').off('input').on('input', function() {
        const placeholderId = $(this).data('id');
        const newContent = $(this).val();
        updatePlaceholderContent(placeholderId, newContent);
    });
    
    // 상단 삭제 버튼 클릭 이벤트
    template.find('#delete-placeholder-btn').off('click').on('click', function() {
        if (selectedPlaceholderId) {
            if (confirm('이 플레이스홀더를 삭제하시겠습니까?')) {
                deletePlaceholder(template, selectedPlaceholderId);
            }
        }
    });
    
    // 내용 지우기 버튼 클릭 이벤트
    template.find('.placeholder-clear-content-btn').off('click').on('click', function() {
        const placeholderId = $(this).data('id');
        if (confirm('이 플레이스홀더의 내용을 모두 지우시겠습니까?')) {
            clearPlaceholderContent(template, placeholderId);
        }
    });
}

// 플레이스홀더 제목 업데이트
function updatePlaceholderTitle(placeholderId, newTitle) {
    const placeholders = extension_settings[extensionName].placeholders;
    const placeholder = placeholders.find(p => p.id === placeholderId);
    if (placeholder) {
        placeholder.name = newTitle;
        saveSettingsDebounced();
    }
}

// 플레이스홀더 내용 업데이트
function updatePlaceholderContent(placeholderId, newContent) {
    const placeholders = extension_settings[extensionName].placeholders;
    const placeholder = placeholders.find(p => p.id === placeholderId);
    if (placeholder) {
        placeholder.content = newContent;
        applyPlaceholderToSystem(placeholder);
        saveSettingsDebounced();
    }
}

// 플레이스홀더 삭제
function deletePlaceholder(template, placeholderId) {
    const placeholders = extension_settings[extensionName].placeholders;
    const placeholderIndex = placeholders.findIndex(p => p.id === placeholderId);
    
    if (placeholderIndex !== -1) {
        // 시스템에서 제거
        removePlaceholderFromSystem(placeholders[placeholderIndex]);
        
        // 배열에서 제거
        placeholders.splice(placeholderIndex, 1);
        
        // 선택된 플레이스홀더 조정
        if (placeholders.length > 0) {
            selectedPlaceholderId = placeholders[0].id;
        } else {
            selectedPlaceholderId = null;
        }
        
        // UI 업데이트
        renderDropdown(template);
        renderEditor(template);
        setupEventListeners(template);
        
        saveSettingsDebounced();
    }
}

// 플레이스홀더 내용 지우기
function clearPlaceholderContent(template, placeholderId) {
    const placeholders = extension_settings[extensionName].placeholders;
    const placeholder = placeholders.find(p => p.id === placeholderId);
    
    if (placeholder) {
        placeholder.content = "";
        applyPlaceholderToSystem(placeholder);
        
        // UI 업데이트 (편집기만 다시 렌더링)
        renderEditor(template);
        setupEventListeners(template);
        
        saveSettingsDebounced();
    }
}

// 플레이스홀더를 시스템에 적용
function applyPlaceholderToSystem(placeholder) {
    if (placeholder.variable && placeholder.variable.trim()) {
        const variableName = placeholder.variable.trim();
        
        // 시스템 예약어 검사 - 중요한 안전장치!
        if (RESERVED_WORDS.includes(variableName.toLowerCase())) {
            // 시스템 예약어는 매크로로 등록하지 않음 (시스템 보호)
            return;
        }
        
        try {
            // SillyTavern의 MacrosParser를 사용한 올바른 매크로 등록
            const context = getContext();
            if (context && context.registerMacro) {
                // 기존 매크로가 있으면 먼저 제거 (중복 경고 방지)
                if (context.unregisterMacro) {
                    context.unregisterMacro(variableName);
                }
                
                // 빈 값 처리 - 빈 문자열도 유효한 플레이스홀더 값으로 처리
                const content = placeholder.content || '';
                context.registerMacro(variableName, content, `사용자 정의 플레이스홀더: ${placeholder.name || variableName}`);
            }
        } catch (error) {
            // 에러 발생 시 무시 (확장 기능이 주요 기능을 방해하지 않도록)
        }
    }
}

// 시스템에서 플레이스홀더 제거
function removePlaceholderFromSystem(placeholder) {
    if (placeholder.variable && placeholder.variable.trim()) {
        const variableName = placeholder.variable.trim();
        
        // 시스템 예약어 검사 - 시스템 매크로는 건드리지 않음
        if (RESERVED_WORDS.includes(variableName.toLowerCase())) {
            // 시스템 예약어는 제거하지 않음 (시스템 보호)
            return;
        }
        
        try {
            // SillyTavern의 MacrosParser를 사용한 올바른 매크로 제거
            const context = getContext();
            if (context && context.unregisterMacro) {
                context.unregisterMacro(variableName);
            }
        } catch (error) {
            // 에러 발생 시 무시 (확장 기능이 주요 기능을 방해하지 않도록)
        }
    }
}

// 모든 플레이스홀더 값 업데이트 (초기 로드용)
function updateAllPlaceholders() {
    const placeholders = extension_settings[extensionName].placeholders || [];
    
    // 각 플레이스홀더를 시스템에 적용
    placeholders.forEach(placeholder => {
        if (placeholder.variable && placeholder.variable.trim()) {
            applyPlaceholderToSystem(placeholder);
        }
    });
}

// 슬래시 커맨드 등록
function registerSlashCommands() {
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'placeholder',
            callback: async (parsedArgs) => {
                openPlaceholderManagerPopup();
                return '';
            },
            helpString: '플레이스홀더 관리 창을 엽니다.\n사용법: /placeholder',
            namedArgumentList: [],
            returns: '플레이스홀더 관리 창 열기',
        }));
        
        // ph-set 커맨드 추가
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'ph-set',
            callback: async (args, value) => {
                const varName = args.var;
                const newValue = value || '';
                
                if (!varName) {
                    if (typeof toastr !== 'undefined') {
                        toastr.error('변수명을 지정해주세요. 사용법: /ph-set var=변수명 값');
                    } else {
                        alert('변수명을 지정해주세요. 사용법: /ph-set var=변수명 값');
                    }
                    return '';
                }
                
                const placeholders = extension_settings[extensionName].placeholders || [];
                const placeholder = placeholders.find(p => p.variable === varName);
                
                if (!placeholder) {
                    if (typeof toastr !== 'undefined') {
                        toastr.warning(`플레이스홀더 '${varName}'를 찾을 수 없습니다.`);
                    } else {
                        alert(`플레이스홀더 '${varName}'를 찾을 수 없습니다.`);
                    }
                    return '';
                }
                
                // 시스템 예약어는 수정하지 않음 (안전장치)
                if (RESERVED_WORDS.includes(varName.toLowerCase())) {
                    if (typeof toastr !== 'undefined') {
                        toastr.error(`'${varName}'는 SillyTavern 시스템 예약어입니다. 수정할 수 없습니다.`);
                    } else {
                        alert(`'${varName}'는 SillyTavern 시스템 예약어입니다. 수정할 수 없습니다.`);
                    }
                    return '';
                }
                
                                 // 값 업데이트
                 placeholder.content = newValue;
                 applyPlaceholderToSystem(placeholder);
                 saveSettingsDebounced();
                 
                 return '';
            },
            helpString: '플레이스홀더의 값을 설정합니다.\n사용법: /ph-set var=변수명 값',
            namedArgumentList: [
                SlashCommandNamedArgument.fromProps({
                    name: 'var',
                    description: '설정할 플레이스홀더 변수명',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: true,
                }),
            ],
            unnamedArgumentList: [
                SlashCommandNamedArgument.fromProps({
                    name: 'value',
                    description: '설정할 값',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: false,
                }),
            ],
            returns: '플레이스홀더 값 설정',
        }));
        
        // ph-get 커맨드 추가
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'ph-get',
            callback: async (args) => {
                const varName = args.var;
                
                if (!varName) {
                    if (typeof toastr !== 'undefined') {
                        toastr.error('변수명을 지정해주세요. 사용법: /ph-get var=변수명');
                    } else {
                        alert('변수명을 지정해주세요. 사용법: /ph-get var=변수명');
                    }
                    return '';
                }
                
                const placeholders = extension_settings[extensionName].placeholders || [];
                const placeholder = placeholders.find(p => p.variable === varName);
                
                if (!placeholder) {
                    if (typeof toastr !== 'undefined') {
                        toastr.warning(`플레이스홀더 '${varName}'를 찾을 수 없습니다.`);
                    } else {
                        alert(`플레이스홀더 '${varName}'를 찾을 수 없습니다.`);
                    }
                    return '';
                }
                
                // 현재 값 반환
                const currentValue = placeholder.content || '';
                
                return currentValue;
            },
            helpString: '플레이스홀더의 현재 값을 조회합니다.\n사용법: /ph-get var=변수명',
            namedArgumentList: [
                SlashCommandNamedArgument.fromProps({
                    name: 'var',
                    description: '조회할 플레이스홀더 변수명',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: true,
                }),
            ],
            returns: '플레이스홀더 현재 값',
        }));
        
        
         } catch (error) {
         // 실패 시 5초 후 재시도
         setTimeout(registerSlashCommands, 5000);
     }
}

// 요술봉메뉴에 버튼 추가
async function addToWandMenu() {
    try {
        const buttonHtml = await $.get(`${extensionFolderPath}/button.html`);
        
        const extensionsMenu = $("#extensionsMenu");
        if (extensionsMenu.length > 0) {
            extensionsMenu.append(buttonHtml);
            $("#placeholder_manager_button").on("click", openPlaceholderManagerPopup);
        } else {
            setTimeout(addToWandMenu, 1000);
        }
         } catch (error) {
         // button.html 로드 실패
     }
}

// 확장 초기화
jQuery(async () => {
    await loadSettings();
    await addToWandMenu();
    updateAllPlaceholders();
    
         // SillyTavern 로드 완료 후 슬래시 커맨드 등록
     setTimeout(registerSlashCommands, 2000);
 }); 