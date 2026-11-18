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

function Para(el)
  if FORMAT ~= "docx" then
    return el
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
