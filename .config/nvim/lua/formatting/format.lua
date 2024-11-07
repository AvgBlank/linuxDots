-- Function to format the current file based on file type
function FormatFile(file)
  local format_cmd

  -- If no file is provided, use the current buffer
  if not file then
    file = vim.fn.expand '%:p' -- Get the full path of the current buffer
    ISFILE = true
    vim.cmd 'silent w'
  end

  -- Determine the file type based on the file extension
  local ft = vim.fn.fnamemodify(file, ':e')

  if ft == 'html' or ft == 'css' or ft == 'js' or ft == 'json' or ft == 'md' or ft == 'yml' then
    format_cmd = 'prettier "' .. file .. '" --write > /dev/null 2>&1'
  elseif ft == 'lua' then
    format_cmd = 'stylua --indent-type Spaces --indent-width 2 "' .. file .. '" > /dev/null 2>&1'
  elseif ft == 'py' then
    format_cmd = 'black "' .. file .. '" > /dev/null 2>&1'
  elseif ft == 'c' or ft == 'cpp' then
    format_cmd = 'clang-format -i "' .. file .. '" > /dev/null 2>&1'
  else
    return 'No formatter configured for file type: ' .. ft
  end

  -- Run the formatter without opening the file in Vim
  local result = os.execute(format_cmd)

  -- Reload the buffer and return 'Successful' if formatting was successful
  if ISFILE then
    if result == 0 then
      vim.cmd 'edit'
      return 'Successfully formatted: ' .. vim.fn.expand '%:t'
    end
    -- Return 'Failed' if formatting was unsuccessful
    return 'Failed to format: ' .. file
  end

  return result == 0 and ('Successfully formatted: ' .. file) or ('Failed to format: ' .. file)
end

-- Function to format all files in the current project
function FormatProject()
  local extensions = { 'html', 'css', 'js', 'json', 'lua', 'py', 'c', 'cpp', 'md', 'yml' }
  local formatted_files = {}

  for _, ext in ipairs(extensions) do
    local pattern = string.format('**/*.%s', ext)
    local files = vim.fn.glob(pattern, true, true) -- Get a list of files matching the pattern

    for _, file in ipairs(files) do
      local result = FormatFile(file) -- Call FormatFile for each file
      table.insert(formatted_files, result) -- Keep track of formatted files
    end
  end

  -- Print summary of formatted files
  if #formatted_files > 0 then
    print 'Formatted files:'
    for _, res in ipairs(formatted_files) do
      print(res)
    end
  else
    print 'No files formatted.'
  end
end

-- Set up <space>ff keybinding to format files based on file type
vim.api.nvim_set_keymap(
  'n',
  '<leader>ff',
  ':lua print(FormatFile())<CR>',
  { noremap = true, silent = true, desc = 'Format Current File' }
)

-- Set up <space>fp keybinding to format the entire project
vim.api.nvim_set_keymap(
  'n',
  '<leader>fp',
  ':lua FormatProject()<CR>',
  { noremap = true, silent = true, desc = 'Format Entire Project' }
)
