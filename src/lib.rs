use zed_extension_api as zed;

struct MyExtension {}

impl zed::Extension for MyExtension {
    fn new() -> Self
    where
        Self: Sized,
    {
        todo!()
    }
}

zed::register_extension!(MyExtension);
