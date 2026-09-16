# Overview

An External Extension for [Marinara Engine](https://github.com/Pasta-Devs/Marinara-Engine) to alter scrolling behavior.

The extension targets Marinara Engine 2.4.6 and later. It requires **Full page access** because its controls and autoscroll behavior integrate with Marinara's page DOM.

## Installation

1. Enable third-party extension imports in Marinara's External Extensions settings.
2. Import this folder through **Settings > Addons > External Extensions**.
3. Review the code and approve the exact hash, including the Full page access permission.
4. Enable the extension and reload Marinara if the page still contains old extension elements.

## Usage

### Scroll Buttons

On the side of the screen, are two buttons for scrolling the page: Up and Down. When you tap them, they... ya know....

### Available Gestures

- Single tap
- Double tap
- Long press

### Available Actions

- Scroll up/down a configurable distance.
- Scroll to the next/previous message.
- Scroll all the way to the top or bottom of the page. 

### Autoscroll Control

When the AI is outputting a long message, the application autoscrolls so the end of the message is always at the bottom of the screen. 

With 'Autoscroll Control', the following behaviors can be chosen from: 
- Only autoscroll until the new message has reached the top of the screen. Then, stop scrolling so the user can read the message. 
- Do not autoscroll at all. 


## Options
Options are available in the extensions menu, just like with the Rigged Swipe extension. You can move the arrows to the left or right side of the screen, or change the action of each tap type. 

Additionally, you can set autoscroll to either 'full (ME default behavior) | partial (Scroll Assistant default selected option) | disabled (no autoscroll at all)'

You can hide the buttons if you only want to use the autoscroll control. 

## Info
- **Author:** jake9000
- **License:** CC-0, no rights reserved
- **Targeting:** Marinara Engine v2.4.6+
