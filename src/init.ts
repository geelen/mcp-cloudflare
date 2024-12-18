// Shell out to `npx wrangler@latest whoami`
import { exec } from 'child_process'
import { promisify } from 'util'
import {
  AccountInfo,
  fetchInternal,
  FetchResult,
  getAuthTokens,
  isAccessTokenExpired,
  isDirectory,
  refreshToken,
} from './utils/wrangler'
import chalk from 'chalk'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)

const execAsync = promisify(exec)

export async function init(accountTag: string | undefined) {
  try {
    getAuthTokens()
  } catch (e: any) {
    console.log(
      `Caught error while reading Wrangler auth info:\n  ${chalk.gray(e.message)}\n${chalk.yellow(`Running 'wrangler login' and retrying...`)}`,
    )

    await execAsync('npx wrangler@latest login')
    getAuthTokens()
  }

  console.log(`✅ Wrangler auth info loaded!`)

  if (isAccessTokenExpired()) {
    if (await refreshToken()) {
      console.log('Successfully refreshed access token')
    } else {
      console.log('Failed to refresh access token')
    }
  }

  const { result: accounts } = await fetchInternal<FetchResult<AccountInfo[]>>('/accounts')

  let account: string
  switch (accounts.length) {
    case 0:
      throw new Error(`No accounts found. Run 'wrangler whoami' for more info.`)
    case 1:
      if (accountTag && accountTag !== accounts[0].id) {
        throw new Error(`You don't have access to account ${accountTag}. Leave blank to use ${accounts[0].id}.`)
      }
      account = accounts[0].id
      break
    default:
      if (!accountTag) {
        throw new Error(
          `${chalk.red('Multiple accounts found.')}\nUse ${chalk.yellow('npx @cloudflare/mcp-server-cloudflare init [account_id]')} to specify which account to use.\nYou have access to:\n${accounts.map((a) => `  • ${a.name} — ${a.id}`).join('\n')}`,
        )
      }
      account = accountTag
      break
  }

  console.log(`✅ Using account: ${chalk.yellow(account)}`)

  const claudeConfigPath = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Claude',
    'claude_desktop_config.json',
  )
  const cloudflareConfig = {
    command: (await execAsync('which node')).stdout.trim(),
    args: [__filename, 'run', account],
  }

  const configDirExists = isDirectory(path.dirname(claudeConfigPath))
  if (configDirExists) {
    const existingConfig = fs.existsSync(claudeConfigPath)
      ? JSON.parse(fs.readFileSync(claudeConfigPath, 'utf8'))
      : { mcpServers: {} }
    if ('cloudflare' in existingConfig.mcpServers || {}) {
      console.log(
        `Replacing existing Claude Cloudflare MCP config: ${JSON.stringify(existingConfig.mcpServers.cloudflare)}`,
      )
    }
    const newConfig = {
      ...existingConfig,
      mcpServers: {
        ...existingConfig.mcpServers,
        cloudflare: cloudflareConfig,
      },
    }
    fs.writeFileSync(claudeConfigPath, JSON.stringify(newConfig, null, 2))

    console.log(`✅ mcp-server-cloudflare configured & added to Claude Desktop!`)
    console.log(`Wrote the following config:\n${JSON.stringify(newConfig, null, 2)}`)
    console.log(`Try asking Claude to "tell me which Workers I have on my account" to get started!`)
  } else {
    const fullConfig = { mcpServers: { cloudflare: cloudflareConfig } }
    console.log(
      `Couldn't detect Claude Desktop config at ${claudeConfigPath}.\nTo add the Cloudflare MCP server manually, add the following config to your ${chalk.yellow('claude_desktop_configs.json')} file:\n\n${JSON.stringify(fullConfig, null, 2)}`,
    )
  }
}
