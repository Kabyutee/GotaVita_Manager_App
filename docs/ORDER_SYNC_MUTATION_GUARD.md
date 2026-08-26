# Order sync mutation guard

The canonical remote reconciliation bridge now defers reconciliation while the New Order or Edit Order form is actively submitting. This prevents remote canonical state replacement from interrupting an in-flight local Order mutation.
