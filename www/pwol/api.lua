#!/usr/bin/lua
require("uci");
require("nixio");
require("luci.jsonc");
require("luci.http");
require("luci.ip");

local dev_list_path = "/www/pwol/dev_list.txt";

function contains(arr, val) local k,v; for k,v in ipairs(arr) do if (v == val) then return true; end; end; return false; end;
function to_bool(val) if ((val == 0) or (val == nil) or (val == "")) then return false; end; return true; end;
function is_online(ip)
	local ret = os.execute(string.format("ping -4 -W 1 -c 1 '%s' > /dev/null", ip));
	return not to_bool(ret);
end;
function read_pub_hosts_list(file_path)
	local ret = {};
	local hfile = io.open(file_path, 'r');
	if (not hfile) then return nil; end;

	for line in hfile:lines() do
		if (to_bool(line)) then table.insert(ret, line); end;
	end;

	hfile:close();
	return ret;
end;

local host_info = {};  -- { ['dev'] = { ['mac'] = '00:11:22:33:44:55', ['ip'] = "192.168.1.2" } };

local host_ctl = {

	['hl'] = function () -- host list
		return host_info;
	end,

	['hs'] = function (host) -- host state
		local ret = {};

		if (host) then -- if value of 'host' is empty, return statuses of all known hosts
			local info = host_info[host];
			if (not info) then return nil; end;
			ret[host] = info;
			ret[host].online = is_online(info.ip);
		else
			for host,info in pairs(host_info) do
				ret[host] = info;
				ret[host].online = is_online(info.ip);
			end;
		end;

		return ret;
	end,

	['hw'] = function (host) -- host wake
		if (not host) then return nil; end;
		local info = host_info[host];
		if (not info) then return nil; end;
		local ret = { [host] = host_info[host] };
		ret[host].wol_ok = not to_bool(os.execute(string.format("etherwake -b -i br-lan '%s' > /dev/null", info.mac)));
		return ret;
	end,

};

local args = luci.http.urldecode_params(nixio.getenv('QUERY_STRING') or arg[1] or "cmd=hl"); -- NOTE: final val is for debugging, when script executed from terminal without args, e.g. `lua api.lua 'cmd=hs&host=computer1'`
local ret = {
	['ok'] = false,
	-- ['args'] = args, -- DEBUG ONLY
};

repeat -- NOTE: fake loop allows shortcuts using 'break'
	local public_hosts = read_pub_hosts_list(dev_list_path); -- { 'dev1', 'dev2', ... }; // NOTE: cwd for FastCGI is '/www'
	if (not public_hosts) then ret.err = "Failed reading list of available hosts"; break; end;

	for k,v in pairs(uci.get_all('dhcp')) do
		-- NOTE: current behaviour is such that only *fully* matching device host names will end up in 'host_info', others will be completely ignored
		if (contains(public_hosts, v.name)) then host_info[v.name] = { mac = v.mac, ip = v.ip }; end;
	end;

	local cmd = host_ctl[args.cmd];
	if (not cmd) then ret.err = "Unknown command"; break; end;
	local data = cmd(args.host);
	if (not data) then ret.err = "Unknown host"; break; end;
	ret.ok = true;
	ret.data = data;
until (true);

print("Status: 200 OK");
print("Content-type: application/json\n");
print(luci.jsonc.stringify(ret, '\t'));
