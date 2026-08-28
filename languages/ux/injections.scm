; <script>
((script_element
  (start_tag) @_no_lang
  (raw_text) @injection.content)
  (#not-match? @_no_lang "lang=")
  (#set! injection.language "javascript"))

; <script lang="js">
((script_element
  (start_tag
    (attribute
      (attribute_name) @_lang
      (quoted_attribute_value
        (attribute_value) @_js)))
  (raw_text) @injection.content)
  (#eq? @_lang "lang")
  (#eq? @_js "js")
  (#set! injection.language "javascript"))

; <script lang="ts">
((script_element
  (start_tag
    (attribute
      (attribute_name) @_lang
      (quoted_attribute_value
        (attribute_value) @_ts)))
  (raw_text) @injection.content)
  (#eq? @_lang "lang")
  (#eq? @_ts "ts")
  (#set! injection.language "typescript"))

; <script lang="tsx">
; <script lang="jsx">
; Zed built-in tsx, we mark it as tsx ^:)
(script_element
  (start_tag
    (attribute
      (attribute_name) @_attr
      (quoted_attribute_value
        (attribute_value) @injection.language)))
  (#eq? @_attr "lang")
  (#any-of? @injection.language "tsx" "jsx")
  (raw_text) @injection.content)

; {{ }}
((interpolation
  (raw_text) @injection.content)
  (#set! injection.language "typescript"))

; v-
(directive_attribute
  (quoted_attribute_value
    (attribute_value) @injection.content
    (#set! injection.language "typescript")))

; Vue <style lang="css"> injections
(style_element
  (start_tag
    (attribute
      (attribute_name) @_attr_name
      (#eq? @_attr_name "lang")
      (quoted_attribute_value
        (attribute_value) @injection.language)))
  (raw_text) @injection.content)

; Vue <style lang="scss"> injections
((style_element
  (start_tag
    (attribute
      (attribute_name) @_attr_name
      (#eq? @_attr_name "lang")
      (quoted_attribute_value
        (attribute_value) @injection.language)))
  (raw_text) @injection.content)
  (#eq? @injection.language "scss")
  (#set! injection.language "scss"))

; Vue <style lang="less"> injections
((style_element
  (start_tag
    (attribute
      (attribute_name) @_attr_name
      (#eq? @_attr_name "lang")
      (quoted_attribute_value
        (attribute_value) @injection.language)))
  (raw_text) @injection.content)
  (#eq? @injection.language "less")
  (#set! injection.language "less"))

; Vue <style> css injections (no lang attribute)
(style_element
  (start_tag
    (attribute
      (attribute_name) @_attr_name)*)
  (raw_text) @injection.content
  (#not-any-of? @_attr_name "lang")
  (#set! injection.language "css"))

; <template lang="pug">
((template_element
  (start_tag
    (attribute
      (attribute_name) @_lang
      (quoted_attribute_value
        (attribute_value) @_pug)))
  (text) @injection.content)
  (#eq? @_lang "lang")
  (#eq? @_pug "pug")
  (#set! injection.language "pug"))

; <!-- -->
; Make comment as html
((comment) @injection.content
  (#set! injection.language "html"))
