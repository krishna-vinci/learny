local callouts = { definition = "Definition", theorem = "Theorem", example = "Example", deeper = "Deeper" }

-- Chapter headings read "Chapter N · Title"; notes commonly repeat just the title below.
local function title_of(header)
  return (pandoc.utils.stringify(header.content):gsub("^Chapter %d+ · ", ""))
end

function Pandoc(doc)
  -- User-authored raw code and images never reach the compiler or trigger fetches.
  doc = doc:walk({
    RawBlock = function() return {} end,
    RawInline = function() return {} end,
    Image = function(image)
      if image.src:match("^media/[a-zA-Z0-9._-]+$") then
        image.attributes.width = "100%"
        return image
      end
      local caption = pandoc.utils.stringify(image.caption)
      return pandoc.Emph({pandoc.Str(caption .. " (image: " .. image.src .. ")")})
    end,
    Div = function(div)
      if div.classes:includes("book-chapter") then
        local chapter = div.content[1]
        if not chapter or chapter.t ~= "Header" then return nil end
        table.remove(div.content, 1)
        -- Notes commonly repeat their frontmatter title as the first heading.
        if div.content[1] and div.content[1].t == "Header" and
          title_of(div.content[1]) == title_of(chapter) then
          table.remove(div.content, 1)
        end
        -- The shallowest remaining heading starts directly beneath the chapter.
        local shallowest = 6
        div:walk({ Header = function(h) shallowest = math.min(shallowest, h.level) end })
        div = div:walk({ Header = function(h) h.level = h.level + 2 - shallowest; return h end })
        table.insert(div.content, 1, chapter)
        return div.content
      end
    end,
  })
  return doc:walk({
    Div = function(div)
      for class, label in pairs(callouts) do
        if div.classes:includes(class) then
          local body = pandoc.write(pandoc.Pandoc(div.content), "typst")
          return pandoc.RawBlock("typst", '#book-callout("' .. label .. '")[\n' .. body .. '\n]')
        end
      end
    end,
  })
end
