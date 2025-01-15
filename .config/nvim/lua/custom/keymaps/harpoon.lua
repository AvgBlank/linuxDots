-- Function to pick a file with your custom Telescope command and add it to Harpoon
local function pick_and_add_to_harpoon()
  local telescope_builtin = require("telescope.builtin")
  local harpoon_mark = require("harpoon.mark")

  -- Use your custom Telescope command
  telescope_builtin.find_files({
    find_command = { "rg", "--files", "--hidden", "-g", "!.git" },
    prompt_title = "Pick a file to add to Harpoon",
    attach_mappings = function(_, map)
      -- Add file to Harpoon on <CR>
      map("i", "<CR>", function(prompt_bufnr)
        local actions = require("telescope.actions")
        local action_state = require("telescope.actions.state")
        local entry = action_state.get_selected_entry()

        -- Add the selected file to Harpoon
        if entry then
          harpoon_mark.add_file(entry.path)
        end

        -- Close Telescope
        actions.close(prompt_bufnr)
      end)
      return true
    end,
  })
end

-- Map <leader>ht to the function
vim.keymap.set("n", "<leader>ht", pick_and_add_to_harpoon, { desc = "Pick a file and add to Harpoon" })
