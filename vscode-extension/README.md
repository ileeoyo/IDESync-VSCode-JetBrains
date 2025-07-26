# IDE Sync - VSCode-JetBrains IDE Sync

> **Note:** This synchronization system is suitable for VSCode, VSCode forks like Cursor or Windsurf as well as JetBrains IntelliJ-based IDEs like Rider, IntelliJ IDEA and WebStorm.

![IDE Sync Demo](20250724.gif)

A **decentralized synchronization system** based on **multicast technology** that enables seamless real-time synchronization between multiple VSCode and JetBrains IDE instances simultaneously. No central server required - all IDEs communicate directly with each other in a peer-to-peer fashion.

## Key Features

-   **🔄 Decentralized Architecture**: No central server - direct peer-to-peer communication via multicast
-   **📂 File Operations Sync**: Automatically synchronizes file opening and closing across all connected IDEs
-   **🎯 Cursor Position Sync**: Real-time cursor position and selection synchronization
-   **🔗 Multi-Instance Support**: Connect unlimited VSCode and JetBrains IDE instances simultaneously
-   **⚡ Zero Configuration**: Automatic discovery and connection of IDE instances on the same network
-   **🌐 Cross-Platform**: Works seamlessly across Windows, macOS, and Linux

## How It Works

Unlike traditional client-server architectures, this plugin uses **UDP multicast** to create a decentralized network where:

-   Each IDE instance broadcasts its state changes (file operations, cursor movements) to all other instances
-   No single point of failure - remove any IDE instance without affecting others
-   Automatic peer discovery - new IDE instances automatically join the synchronization network
-   Low latency communication for smooth real-time synchronization

## Synchronized Operations

### File Operations

-   **File Opening**: When you open a file in any IDE, it automatically opens in all connected IDEs
-   **File Closing**: Closing a file in one IDE closes it in all other connected IDEs
-   **File Switching**: Switching between files synchronizes the active file across all IDEs

### Editor State

-   **Cursor Position**: Real-time cursor position synchronization with line and column accuracy

## Installation

### VSCode Extension

1. Visit [GitHub Releases](https://github.com/ileeoyo/IDESync-VSCode-JetBrains/releases)
2. Download the latest `.vsix` file for VSCode
3. Open VSCode and press `Ctrl+Shift+P`
4. Type "Extensions: Install from VSIX..." and select it
5. Choose the downloaded `.vsix` file
6. Restart VSCode

### JetBrains IDE Plugin

1. Visit [GitHub Releases](https://github.com/ileeoyo/IDESync-VSCode-JetBrains/releases)
2. Download the latest `.zip` file for JetBrains IDE
3. Open JetBrains IDE and go to Settings > Plugins
4. Click the gear icon and select "Install Plugin from Disk..."
5. Choose the downloaded `.zip` file
6. Restart JetBrains IDE

## Version Compatibility

### VSCode

-   Supported versions: VSCode 1.84.0 and newer
-   Compatible with VSCode forks: Cursor, Windsurf, etc.

### JetBrains IDE

-   Supported versions: 2023.3 and newer
-   Compatible IDEs: IntelliJ IDEA, WebStorm, Rider, PyCharm, etc.

## Configuration

The plugin works out-of-the-box with automatic network discovery. Optional settings:

-   **Multicast Port**: Configure multicast port for group identification (default: 3000)
-   **Network Interface**: Prioritizes local loopback interface, auto-selects others if loopback fails

Access settings:

-   In VSCode: Settings > Extensions > IDE Sync - Connect to JetBrains IDE
-   In JetBrains IDE: Settings > Tools > IDE Sync - Connect to VSCode

## Usage

1. Install the plugin in all desired IDE instances (VSCode and/or JetBrains IDEs)
2. Start your IDEs - they will automatically discover each other on the network
3. Check the status bar indicator to confirm connection status
4. Start coding - all file operations and cursor movements will sync automatically!

## Network Requirements

-   All IDE instances must be on the same local machine (localhost only)
-   UDP multicast must be enabled on the local loopback interface
-   Firewall should allow UDP multicast traffic on localhost (the plugin will prompt if needed)
-   Plugin uses local loopback interface for same-machine synchronization

## Troubleshooting

### Error Log Locations

When experiencing synchronization issues, check the error logs in the following locations:

#### VSCode Extension Logs

-   **Output Panel**: View > Output, then select "IDE 同步" from the dropdown

#### JetBrains IDE Plugin Logs

-   **IDE Built-in Log Viewer**:
    -   Go to Help > Show Log in Explorer/Finder/Files
    -   Open `idea.log` file

## Components

### VSCode Extension

-   Located in `/vscode-extension`
-   Monitors file operations and cursor position in VSCode
-   Communicates via UDP multicast for decentralized synchronization

### JetBrains IDE Plugin

-   Located in `/jetbrains-plugin`
-   Monitors file operations and cursor position in JetBrains IDEs
-   Participates in the multicast synchronization network

## Building

### Prerequisites

-   Node.js and npm for VSCode extension
-   JDK 17+ and Gradle for JetBrains IDE plugin

### Build Steps

1. Clone the repository

```bash
git clone https://github.com/ileeoyo/IDESync-VSCode-JetBrains.git
cd IDESync-VSCode-JetBrains
```

2. Build VSCode extension

```bash
cd vscode-extension
npm install
npm run build
npm run package
cd ..
```

3. Build JetBrains plugin

```bash
cd jetbrains-plugin
./gradlew buildPlugin
cd ..
```

## Feedback & Issues

Please report issues or suggestions on [GitHub](https://github.com/ileeoyo/IDESync-VSCode-JetBrains/issues).
