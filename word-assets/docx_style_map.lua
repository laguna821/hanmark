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
