last_was_heading = false

local function clone_attributes(el)
  local identifier = el.identifier or ""
  local classes = el.classes or {}
  local attributes = {}

  if el.attributes then
    for key, value in pairs(el.attributes) do
      attributes[key] = value
    end
  end

  return pandoc.Attr(identifier, classes, attributes)
end

local function set_custom_style(attr, style_name)
  attr.attributes["custom-style"] = style_name
  return attr
end

function Header(el)
  if FORMAT ~= "docx" then
    return el
  end

  last_was_heading = true
  return pandoc.Header(
    el.level,
    el.content,
    set_custom_style(clone_attributes(el), "Heading " .. tostring(math.min(el.level, 6)))
  )
end

-- HanMark draws Mermaid diagrams as PNG pictures and marks each one with a text chunk
-- "hanmark-scale" right after the PNG header (value: scale digit, then "c" when the next
-- paragraph is the caption). Read the mark from the start of the data URL so the picture
-- paragraph is centred and its caption gets the built-in writer's style (R-033).
local BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

local function decode_base64_head(text, count)
  local out = {}
  local bits, held = 0, 0
  for index = 1, math.min(#text, count) do
    local value = BASE64:find(text:sub(index, index), 1, true)
    if not value then
      break
    end
    held = held * 64 + (value - 1)
    bits = bits + 6
    if bits >= 8 then
      bits = bits - 8
      local byte = math.floor(held / (2 ^ bits))
      held = held % (2 ^ bits)
      out[#out + 1] = string.char(byte)
    end
  end
  return table.concat(out)
end

-- nil for other images, "plain" for a diagram, "captioned" when its caption follows.
local function diagram_mark(el)
  if #el.content ~= 1 or el.content[1].t ~= "Image" then
    return nil
  end
  local data = el.content[1].src:match("^data:image/png;base64,(.*)$")
  if not data then
    return nil
  end
  local head = decode_base64_head(data, 400)
  -- The chunk length (4 bytes before "tEXt") tells whether the "c" belongs to the mark;
  -- the byte after the text is the chunk's checksum and may itself be a "c".
  local at = head:find("tEXthanmark%-scale%z%d")
  if not at or at < 5 then
    return nil
  end
  local b1, b2, b3, b4 = head:byte(at - 4, at - 1)
  local length = ((b1 * 256 + b2) * 256 + b3) * 256 + b4
  local text = head:sub(at + 4, at + 3 + length)
  if text:match("^hanmark%-scale%z[1-8]c$") then
    return "captioned"
  end
  if text:match("^hanmark%-scale%z[1-8]$") then
    return "plain"
  end
  return nil
end

local caption_follows = false

function Para(el)
  if FORMAT ~= "docx" then
    return el
  end

  local mark = diagram_mark(el)
  if mark then
    last_was_heading = false
    caption_follows = mark == "captioned"
    return pandoc.Div({ el }, pandoc.Attr("", {}, { ["custom-style"] = "Diagram Figure" }))
  end
  if caption_follows then
    caption_follows = false
    last_was_heading = false
    return pandoc.Div({ el }, pandoc.Attr("", {}, { ["custom-style"] = "Image Caption" }))
  end

  local style_name = last_was_heading and "First Paragraph" or "Body Text"
  last_was_heading = false
  return pandoc.Div({ el }, pandoc.Attr("", {}, { ["custom-style"] = style_name }))
end

function BlockQuote(el)
  if FORMAT ~= "docx" then
    return el
  end

  last_was_heading = false
  return pandoc.Div(el.content, pandoc.Attr("", {}, { ["custom-style"] = "Block Text" }))
end

function CodeBlock(el)
  if FORMAT ~= "docx" then
    return el
  end

  last_was_heading = false
  return pandoc.Div({ pandoc.CodeBlock(el.text, el.attr) }, pandoc.Attr("", {}, { ["custom-style"] = "Source Code" }))
end

function BulletList(el)
  last_was_heading = false
  return el
end

function OrderedList(el)
  last_was_heading = false
  return el
end

function Table(el)
  last_was_heading = false
  return el
end

-- <sup>…</sup> and <sub>…</sub> reach Pandoc's GFM reader as raw HTML, which the
-- DOCX writer drops (the text stays at body size). Turn each pair into a real
-- Superscript or Subscript so both DOCX paths agree (HanMark 3.0.0).
local SCRIPT_INLINES = { sup = pandoc.Superscript, sub = pandoc.Subscript }

local function raw_html(el, text)
  return el.t == "RawInline" and el.format == "html" and el.text == text
end

function Inlines(inlines)
  if FORMAT ~= "docx" then
    return nil
  end

  local output = pandoc.List()
  local changed = false
  local index = 1
  while index <= #inlines do
    local el = inlines[index]
    local tag = nil
    if el.t == "RawInline" and el.format == "html" then
      tag = el.text:match("^<(su[bp])>$")
    end
    local close = nil
    if tag then
      for at = index + 1, #inlines do
        if raw_html(inlines[at], "</" .. tag .. ">") then
          close = at
          break
        end
      end
    end
    if close then
      local inner = pandoc.List()
      for at = index + 1, close - 1 do
        inner:insert(inlines[at])
      end
      output:insert(SCRIPT_INLINES[tag](inner))
      changed = true
      index = close + 1
    else
      output:insert(el)
      index = index + 1
    end
  end

  if changed then
    return output
  end
  return nil
end
