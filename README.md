# Discord Pearlbot
[![Ask DeepWiki](https://devin.ai/assets/askdeepwiki.png)](https://deepwiki.com/VBalazs0/Discord-pearlbot)

This is a Discord bot designed for Minecraft servers that facilitates in-game actions through Discord commands. It allows users to link their Minecraft In-Game-Name (IGN) to their Discord account and then use a command to trigger a pearl teleport in the game. The bot features an admin-approval system for account linking to ensure security.

## Features

-   **Minecraft Account Linking:** Users can request to link their Minecraft IGN to their Discord account via the `/link` command.
-   **Admin Approval System:** Link requests are sent to a designated admin channel for approval or rejection using interactive buttons.
-   **Teleport Command:** Linked users can use the `/tp` command to send a `.tp instapearl [IGN]` message to a specified channel, intended to be read by an in-game bot.
-   **Secure & Permission-based:** The `/tp` command has strict ownership checks, and administrative actions are restricted to designated admin roles.
-   **Persistent Storage:** Linked accounts and pending requests are saved in JSON files, and pending requests are restored on bot restart.
-   **Action Logging:** Bot actions, errors, and warnings are logged to both the console and a `log/actions.log` file.

## Commands

The bot uses Discord slash commands.

### `/link`
Request admin approval to link a Minecraft IGN to a Discord account.

-   **Syntax:** `/link <ign> [account]`
-   **Parameters:**
    -   `ign` (Required): Your Minecraft in-game name.
    -   `account` (Optional): The Discord user to link the IGN to. If omitted, it defaults to the user running the command.
-   **Functionality:** Submits a request to the admin channel. An administrator must approve it before the link is active.

### `/tp`
Sends a `.tp instapearl [IGN]` message to the Pearlbot channel.

-   **Syntax:** `/tp <ign> [account]`
-   **Parameters:**
    -   `ign` (Required): A Minecraft IGN linked to your account.
    -   `account` (Optional, Admins only): The target Discord account for the teleport command.
-   **Functionality:**
    -   For regular users, you can only use IGNs that are linked to your own Discord account.
    -   Admins can use this command on behalf of other users by specifying their Discord account. The target user must have the specified IGN linked to their account.

## Setup and Installation

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/VBalazs0/Discord-pearlbot.git
    cd Discord-pearlbot
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Configuration**
    Create a `config.json` file in the root directory with the following structure:
    ```json
    {
      "AdminRoleIDs": [
        "YOUR_ADMIN_ROLE_ID_1",
        "YOUR_ADMIN_ROLE_ID_2"
      ],
      "channelIDs": {
        "PearlbotChannel": "PEARL_COMMAND_OUTPUT_CHANNEL_ID",
        "AdminLogs": "LINK_REQUEST_APPROVAL_CHANNEL_ID"
      },
    }
    ```
    -   `AdminRoleIDs`: An array of Discord role IDs that are authorized to approve/reject link requests and use admin commands.
    -   `PearlbotChannel`: The channel ID where the `.tp instapearl ...` messages will be sent.
    -   `AdminLogs`: The channel ID where link requests will appear for admin review.
    -   `GUILD_ID`: (Optional but recommended) Your Discord server's ID for instant command registration.

4.  **Environment Variables**
    Create a `.env` file in the root directory to store your bot token:
    ```
    DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE
    ```
    Alternatively, you can add the token and other IDs to `config.json`, but `.env` is recommended for sensitive credentials.

5.  **Run the Bot**
    ```bash
    node main.js
    ```

## Data Files

The bot creates and uses the following files to store data:

-   `accounts.json`: A JSON object mapping Discord user IDs to their linked Minecraft IGNs.
-   `pending.json`: An array of pending link requests.
-   `log/actions.log`: A log file containing timestamps and details of all major actions, warnings, and errors.

## Dependencies

-   [discord.js](https://discord.js.org/): The primary library for interacting with the Discord API.
-   [dotenv](https://www.npmjs.com/package/dotenv): Used for loading environment variables from a `.env` file.
