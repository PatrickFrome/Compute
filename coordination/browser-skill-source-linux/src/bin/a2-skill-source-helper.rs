#![cfg(target_os = "linux")]

#[path = "../helper_protocol.rs"]
mod helper_protocol;

use a2_skill_source_linux::LinuxSkillSource;
use helper_protocol::{
    HelperRequest, HelperResponse, WirePackageFile, read_request, write_response,
};
use std::env;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::ExitCode;

fn run() -> Result<(), &'static str> {
    let mut args = env::args_os();
    let _program = args.next();
    let Some(root) = args.next() else {
        return Err("skill_helper_root_argument_missing");
    };
    if args.next().is_some() {
        return Err("skill_helper_root_argument_count_invalid");
    }

    let root = PathBuf::from(root);
    let source = LinuxSkillSource::open(&root).map_err(|error| error.code())?;
    let _sandbox = source
        .restrict_helper_process()
        .map_err(|error| error.code())?;

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();

    loop {
        let Some(request) = read_request(&mut input).map_err(|error| error.code())? else {
            return Ok(());
        };
        let request_id = request.request_id();
        let opcode = request.opcode();
        let response = match request {
            HelperRequest::ListSkills { .. } => match source.list_skill_names() {
                Ok(names) => HelperResponse::Skills { request_id, names },
                Err(error) => HelperResponse::Error {
                    request_id,
                    opcode,
                    code: error.code().to_owned(),
                },
            },
            HelperRequest::ReadPackage { skill_name, .. } => {
                match source.read_skill_package(&skill_name) {
                    Ok(files) => HelperResponse::Package {
                        request_id,
                        files: files
                            .into_iter()
                            .map(|file| WirePackageFile {
                                path: file.path,
                                executable: file.executable,
                                bytes: file.bytes,
                            })
                            .collect(),
                    },
                    Err(error) => HelperResponse::Error {
                        request_id,
                        opcode,
                        code: error.code().to_owned(),
                    },
                }
            }
        };
        write_response(&mut output, &response).map_err(|error| error.code())?;
        output
            .flush()
            .map_err(|_| "skill_helper_protocol_flush_failed")?;
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(code) => {
            eprintln!("{code}");
            ExitCode::from(70)
        }
    }
}
