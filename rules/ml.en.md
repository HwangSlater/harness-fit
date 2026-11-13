## ML experiments
- Fix seeds (random, numpy, torch …), and read seeds and hyperparameters from config files or arguments, not from code. {{judge}}
- Record the config, commit hash and data version of every run in the experiment tracker (MLflow, wandb …). {{judge}}
- Before claiming an improvement, show numbers against the baseline on the same data and seeds. {{judge}}
- Never overwrite checkpoints or result files; give each run a new name. {{judge}}
- Check on a sample or a short run before training or tuning on the full data, and ask the user before long runs. {{judge}}
