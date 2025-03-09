-- Telescope
require('telescope').setup {
  defaults = {
    file_ignore_patterns = {
      'node_modules',
    },
    path_display = {
      filename_first = {
        reverse_directories = true,
      },
    },
  },
  pickers = {
    find_files = {
      file_ignore_patterns = {
        'node_modules',
      },
    },
  },
  extensions = {
    fzf = {}
  },
}

-- FZF Native
require('telescope').load_extension 'fzf'

-- Harpoon
require("telescope").load_extension('harpoon')

-- Color Scheme
-- Rose Pine
vim.cmd.colorscheme 'rose-pine'
-- Catppuccin Mocha
-- vim.cmd.colorscheme 'catppuccin-mocha'
-- vim.api.nvim_set_hl(0, 'Normal', { bg = 'none' })
-- vim.api.nvim_set_hl(0, 'NormalFloat', { bg = 'none' })
-- Andromeda
-- require("andromeda").setup()

-- Setting Transparency
vim.api.nvim_set_hl(0, 'Normal', { bg = 'none' })
vim.api.nvim_set_hl(0, 'NormalFloat', { bg = 'none' })
vim.api.nvim_set_hl(0, 'NormalNC', { bg = 'none' })     -- Inactive windows
vim.api.nvim_set_hl(0, 'FloatBorder', { bg = 'none' })  -- Floating borders
vim.api.nvim_set_hl(0, 'WinSeparator', { bg = 'none' }) -- Window separators
vim.api.nvim_set_hl(0, 'SignColumn', { bg = 'none' })   -- Sign column (gutter)
vim.api.nvim_set_hl(0, 'EndOfBuffer', { bg = 'none' })  -- End-of-buffer lines

-- Treesitter
require('nvim-treesitter.configs').setup {
  -- A list of parser names, or "all" (the listed parsers MUST always be installed)
  ensure_installed = { 'c', 'lua', 'vim', 'markdown', 'cpp', 'javascript', 'typescript', 'python' },

  -- Install parsers synchronously (only applied to `ensure_installed`)
  sync_install = false,

  -- Automatically install missing parsers when entering buffer
  -- Recommendation: set to false if you don't have `tree-sitter` CLI installed locally
  auto_install = true,

  highlight = {
    enable = true,

    additional_vim_regex_highlighting = false,
  },
}

-- Auto Close Bracket
require('nvim-autopairs').setup {
  enable_check_bracket_line = false,
  ignored_next_char = '[%w%.]',
  map_c_w = true,
}

local npairs = require 'nvim-autopairs'

npairs.setup {
  fast_wrap = {},
}
npairs.setup {
  check_ts = true,
  ts_config = {
    lua = { 'string' }, -- it will not add a pair on that treesitter node
    javascript = { 'template_string' },
  },
}

-- LSP
local lsp = require 'lsp-zero'
lsp.preset 'recommended'
local cmp = require 'cmp'
require('nvim-highlight-colors').setup {}
require('cmp').config.formatting = {
  format = require('tailwindcss-colorizer-cmp').formatter,
}

local cmp_autopairs = require 'nvim-autopairs.completion.cmp'
local cmp_select = { behavior = cmp.SelectBehavior.Select }
cmp.event:on('confirm_done', cmp_autopairs.on_confirm_done())

require('luasnip.loaders.from_vscode').lazy_load()
local luasnip = require 'luasnip'

require('cmp').setup {
  snippet = {
    expand = function(args)
      require('luasnip').lsp_expand(args.body)
    end,
  },
  window = {
    completion = cmp.config.window.bordered(),
    documentation = cmp.config.window.bordered(),
  },
  formatting = {
    format = require('nvim-highlight-colors').format,
  },
  mapping = cmp.mapping.preset.insert {
    ['<C-p>'] = cmp.mapping.select_prev_item(cmp_select),
    ['<C-n>'] = cmp.mapping.select_next_item(cmp_select),
    ['<C-y>'] = cmp.mapping.confirm { select = true }, -- Accept currently selected item. Set `select` to `false` to only confirm explicitly selected items.
    ['<C-e>'] = cmp.mapping.abort(),
    ['<C-Space>'] = cmp.mapping(function(fallback)
      if luasnip.expand_or_jumpable() then
        luasnip.expand_or_jump()
      else
        fallback()
      end
    end, { 'i', 's' }),
    ['<C-S-Space>'] = cmp.mapping(function(fallback)
      if luasnip.jumpable(-1) then
        luasnip.jump(-1)
      else
        fallback()
      end
    end, { 'i', 's' }),
  },
  sources = cmp.config.sources({
    { name = 'nvim_lsp' },
    { name = 'luasnip' },
  }, {
    { name = 'buffer' },
  }),
}
require('mason').setup {}
local lsp_config = require 'lspconfig'
local capabilities = vim.lsp.protocol.make_client_capabilities()
require('mason-lspconfig').setup {
  ensure_installed = {
    'pyright',
    'clangd',
    'lua_ls',
    'eslint',
    'bashls',
    'emmet_language_server',
    'tailwindcss',
    'astro',
    'dockerls',
    'jsonls',
    'prismals'
  },
  handlers = {
    function(server_name)
      require('lspconfig')[server_name].setup {}
    end,
  },
}
lsp_config.lua_ls.setup {
  settings = {
    Lua = {
      diagnostics = {
        globals = { 'vim' },
      },
    },
  },
}
lsp_config.emmet_language_server.setup({
  -- on_attach = on_attach,
  capabilities = capabilities,
  filetypes = { 'html', 'htmldjango', 'typescriptreact', 'javascriptreact', 'typescript', 'css', 'sass', 'scss', 'less', 'javascript' },
  init_options = {
    html = {
      options = {
        -- For possible options, see: https://github.com/emmetio/emmet/blob/master/src/config.ts#L79-L267
        ["bem.enabled"] = true,
      },
    },
  }
})
lsp.setup()

-- Autoclose html Tags
require('nvim-ts-autotag').setup()

-- Lua line
require('lualine').setup {
  -- Rose Pine
  options = { theme = 'rose-pine' },
  -- Catppuccin Mocha
  -- options = { theme = 'catppuccin-mocha' },
}

-- Indent Blankline
require("ibl").setup()

-- Oil.nvim
-- require('oil').setup {
--   default_file_explorer = true,
--   columns = { 'icon' },
--   skip_confirm_for_simple_edits = true,
--   keymaps = {
--     ['<C-h>'] = false,
--     ['<C-j>'] = false,
--     ['<C-k>'] = false,
--     ['<C-l>'] = false,
--   },
--   view_options = {
--     show_hidden = true,
--   },
-- }

-- Conform (Formatter)
require('conform').setup {
  notify_on_error = true,
  notify_no_formatters = true,

  -- Auto Format --
  -- format_on_save = {
  --   timeout_ms = 2000,
  --   lsp_fallback = true,
  -- },

  formatters_by_ft = {
    lua = { 'stylua' },
    python = { 'black' },
    javascript = { 'prettierd', 'prettier', stop_after_first = true },
    typescript = { 'prettierd', 'prettier', stop_after_first = true },
    javascriptreact = { 'prettierd', 'prettier', stop_after_first = true },
    typescriptreact = { 'prettierd', 'prettier', stop_after_first = true },
    astro = { 'prettierd', 'prettier', stop_after_first = true },
    markdown = { 'prettierd', 'prettier', stop_after_first = true },
    json = { 'prettierd', 'prettier', stop_after_first = true },
    html = { 'prettierd', 'prettier', stop_after_first = true },
    htmldjango = { 'prettierd', 'prettier', stop_after_first = true },
    css = { 'prettierd', 'prettier', stop_after_first = true },
    c = { 'clang-format' },
    cpp = { 'clang-format' },
    rust = { 'rustfmt' },
  },
}

-- Color Picker
require('easycolor').setup {
  ui = {
    mappings = {
      ['<C-c>'] = 'close_window', -- Map Ctrl + C to close the window
      ['<C-b>'] = 'close_window', -- Map Ctrl + B to close the window
    },
  },
}
