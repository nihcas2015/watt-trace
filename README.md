# WattTrace — Green Coding IDE Extension

**WattTrace** is a VS Code extension that helps developers write energy-efficient code.  
It analyses source code using a local [Ollama](https://ollama.com) LLM and provides:

- Energy efficiency insights  
- Carbon-per-function style metrics (estimated, hardware-agnostic)  
- Energy-risk scoring  
- Refactoring suggestions focused on computational efficiency  

> ⚠️ This extension **does not** measure real device power usage.  
> It **estimates** energy impact based on code structure, complexity, and resource usage patterns.

---

## Features

| Feature | Description |
|---|---|
| **Energy Badges** | Inline badges next to function definitions (🟢 / 🟡 / 🔴) |
| **Hover Tooltips** | Detailed energy metrics on hover |
| **Sidebar Panel** | Energy overview, carbon-per-function list, refactoring suggestions |
| **Status Bar** | Overall grade + efficiency score |
| **Heatmap** | Background colouring by energy risk |

## Commands

- `WattTrace: Analyze Current File` — Run analysis on the active file  
- `WattTrace: Toggle Energy Heatmap` — Toggle background heatmap on/off  
- `WattTrace: Open WattTrace Panel` — Focus the sidebar  

## Requirements

- **Ollama** running locally (default: `http://localhost:11434`)  
- A model pulled in Ollama (default: `llama3.2`)  

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `watttrace.ollamaModel` | `llama3.2` | Ollama model name |
| `watttrace.ollamaEndpoint` | `http://localhost:11434` | Ollama API endpoint |
| `watttrace.autoAnalyzeOnSave` | `false` | Automatically analyse on save |
| `watttrace.enableHeatmap` | `true` | Enable heatmap decorations |
| `watttrace.showBadges` | `true` | Show inline energy badges |

## Getting Started

1. Install [Ollama](https://ollama.com) and pull a model: `ollama pull llama3.2`  
2. Start Ollama: `ollama serve`  
3. Open a source file in VS Code  
4. Run **WattTrace: Analyze Current File** from the command palette  

## License

MIT
